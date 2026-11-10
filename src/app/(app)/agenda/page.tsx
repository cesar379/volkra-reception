import { DateTime } from "luxon";
import { requireApp } from "@/server/auth";
import { getBusiness, getBusinessHours, getSpecialDays, listServices, listStaff } from "@/server/booking/repo";
import { PageHeader } from "@/components/app/ui";
import { WeekCalendar, type CalAppointment } from "./week-calendar";

export const metadata = { title: "Agenda" };

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireApp();
  const data = await ctx.asUser(async (q) => {
    const business = (await getBusiness(q, ctx.business.id))!;
    const tz = business.timezone;
    const base = sp.semana && /^\d{4}-\d{2}-\d{2}$/.test(sp.semana) ? DateTime.fromISO(sp.semana, { zone: tz }) : DateTime.now().setZone(tz);
    const weekStart = base.startOf("week");
    const weekEnd = weekStart.plus({ days: 7 });
    const [staff, services, hours, specials, appts] = await Promise.all([
      listStaff(q, business.id, false),
      listServices(q, business.id, true),
      getBusinessHours(q, business.id),
      getSpecialDays(q, business.id, weekStart.toISODate()!, weekEnd.toISODate()!),
      q.query<CalAppointment>(
        `select a.id, a.starts_at, a.ends_at, a.status, a.source, a.booking_code, a.is_simulated, a.gcal_sync_status, a.notes,
                a.service_id, sv.name as service_name, sv.duration_min, a.staff_id, st.name as staff_name, st.color as staff_color,
                c.name as customer_name, c.phone as customer_phone
           from appointments a join services sv on sv.id = a.service_id join staff st on st.id = a.staff_id join customers c on c.id = a.customer_id
          where a.business_id = $1 and a.starts_at < $3 and a.ends_at > $2 and a.status <> 'cancelled'
          order by a.starts_at`,
        [business.id, weekStart.toJSDate(), weekEnd.toJSDate()],
      ),
    ]);
    return { business, staff, services, hours, specials: Object.fromEntries(specials), appts, weekStart: weekStart.toISODate()! };
  });

  return (
    <>
      <PageHeader title="Agenda" />
      <WeekCalendar
        timezone={data.business.timezone}
        weekStart={data.weekStart}
        appointments={data.appts.map((a) => ({ ...a, starts_at: new Date(a.starts_at).toISOString(), ends_at: new Date(a.ends_at).toISOString() }))}
        staff={data.staff.map((s) => ({ id: s.id, name: s.name, color: s.color, active: s.active }))}
        services={data.services.map((s) => ({ id: s.id, name: s.name, duration_min: s.duration_min }))}
        hours={data.hours}
        specials={data.specials}
        today={DateTime.now().setZone(data.business.timezone).toISODate()!}
      />
    </>
  );
}
