import type { Queryable } from "../db/client";
import type { HoursRange } from "./availability";

export type Business = {
  id: string;
  name: string;
  vertical: string;
  description: string;
  address: string;
  public_phone: string;
  timezone: string;
  agent_name: string;
  welcome_message: string;
  ai_instructions: string;
  agent_phone_number: string | null;
  vapi_phone_number_id: string | null;
  elevenlabs_agent_id: string | null;
  notify_email: string | null;
  reminder_email: boolean;
  transfer_number: string | null;
  voice_model: string;
  voice_id: string;
  slot_interval_min: number;
  min_notice_min: number;
  max_days_ahead: number;
  minutes_saved_per_call: number;
  store_call_summaries: boolean;
  recording_enabled: boolean;
  google_calendar_id: string | null;
  google_connected: boolean;
  is_demo: boolean;
  web_chat_enabled: boolean;
  web_chat_key: string | null;
  whatsapp_enabled: boolean;
  whatsapp_phone_number_id: string | null;
  whatsapp_display_phone: string | null;
};

export type Service = {
  id: string;
  name: string;
  description: string;
  duration_min: number;
  buffer_min: number;
  price_cents: number | null;
  price_from: boolean;
  active: boolean;
};

export type Staff = { id: string; name: string; role_title: string; color: string; active: boolean; google_calendar_id: string | null };

export type AppointmentRow = {
  id: string;
  business_id: string;
  service_id: string;
  staff_id: string;
  customer_id: string;
  starts_at: Date;
  ends_at: Date;
  status: "confirmed" | "cancelled" | "completed" | "no_show";
  source: "ai_call" | "manual" | "simulator";
  booking_code: string;
  notes: string;
  call_id: string | null;
  is_simulated: boolean;
  gcal_event_id: string | null;
  gcal_sync_status: string;
  updated_at: Date;
};

const BUSINESS_COLS = `id, name, vertical, description, address, public_phone, timezone, agent_name, welcome_message,
  ai_instructions, agent_phone_number, vapi_phone_number_id, elevenlabs_agent_id, notify_email, reminder_email, transfer_number, voice_model, voice_id,
  slot_interval_min, min_notice_min, max_days_ahead, minutes_saved_per_call::float8 as minutes_saved_per_call,
  store_call_summaries, recording_enabled, google_calendar_id, google_connected, is_demo, web_chat_enabled, web_chat_key,
  whatsapp_enabled, whatsapp_phone_number_id, whatsapp_display_phone`;

export async function getBusiness(q: Queryable, businessId: string): Promise<Business | null> {
  const rows = await q.query<Business>(`select ${BUSINESS_COLS} from businesses where id = $1`, [businessId]);
  return rows[0] ?? null;
}

export async function getBusinessByPhone(q: Queryable, opts: { phoneNumberId?: string | null; number?: string | null }): Promise<Business | null> {
  if (opts.phoneNumberId) {
    const r = await q.query<Business>(`select ${BUSINESS_COLS} from businesses where vapi_phone_number_id = $1`, [opts.phoneNumberId]);
    if (r[0]) return r[0];
  }
  if (opts.number) {
    const r = await q.query<Business>(`select ${BUSINESS_COLS} from businesses where agent_phone_number = $1`, [opts.number]);
    if (r[0]) return r[0];
  }
  return null;
}

export async function listServices(q: Queryable, businessId: string, onlyActive = true): Promise<Service[]> {
  return q.query<Service>(
    `select id, name, description, duration_min, buffer_min, price_cents, price_from, active
       from services where business_id = $1 ${onlyActive ? "and active" : ""} order by name`,
    [businessId],
  );
}

export async function listStaff(q: Queryable, businessId: string, onlyActive = true): Promise<Staff[]> {
  return q.query<Staff>(
    `select id, name, role_title, color, active, google_calendar_id from staff where business_id = $1 ${onlyActive ? "and active" : ""} order by name`,
    [businessId],
  );
}

export async function staffForService(q: Queryable, businessId: string, serviceId: string): Promise<Staff[]> {
  return q.query<Staff>(
    `select s.id, s.name, s.role_title, s.color, s.active, s.google_calendar_id
       from staff s join staff_services ss on ss.staff_id = s.id and ss.business_id = s.business_id
      where s.business_id = $1 and ss.service_id = $2 and s.active
      order by s.name`,
    [businessId, serviceId],
  );
}

export async function getBusinessHours(q: Queryable, businessId: string): Promise<Record<number, HoursRange[]>> {
  const rows = await q.query<{ weekday: number; opens: string; closes: string }>(
    `select weekday, to_char(opens, 'HH24:MI') as opens, to_char(closes, 'HH24:MI') as closes
       from business_hours where business_id = $1 order by weekday, opens`,
    [businessId],
  );
  const out: Record<number, HoursRange[]> = {};
  for (const r of rows) (out[r.weekday] ??= []).push({ opens: r.opens, closes: r.closes });
  return out;
}

export async function getStaffHours(q: Queryable, businessId: string): Promise<Record<string, Record<number, HoursRange[]>>> {
  const rows = await q.query<{ staff_id: string; weekday: number; opens: string; closes: string }>(
    `select staff_id, weekday, to_char(opens, 'HH24:MI') as opens, to_char(closes, 'HH24:MI') as closes
       from staff_hours where business_id = $1 order by staff_id, weekday, opens`,
    [businessId],
  );
  const out: Record<string, Record<number, HoursRange[]>> = {};
  for (const r of rows) ((out[r.staff_id] ??= {})[r.weekday] ??= []).push({ opens: r.opens, closes: r.closes });
  return out;
}

export async function getSpecialDays(q: Queryable, businessId: string, from: string, to: string) {
  const rows = await q.query<{ day: string; closed: boolean; hours: HoursRange[]; reason: string }>(
    `select to_char(day, 'YYYY-MM-DD') as day, closed, hours, reason from special_days
      where business_id = $1 and day between $2::date and $3::date`,
    [businessId, from, to],
  );
  return new Map(rows.map((r) => [r.day, { closed: r.closed, hours: r.hours ?? [], reason: r.reason }]));
}

export async function getBusyFromDb(q: Queryable, businessId: string, from: Date, to: Date, excludeAppointmentId?: string) {
  const appts = await q.query<{ staff_id: string; starts_at: Date; ends_at: Date }>(
    `select staff_id, starts_at, ends_at from appointments
      where business_id = $1 and status = 'confirmed' and starts_at < $3 and ends_at > $2
        and ($4::uuid is null or id <> $4::uuid)`,
    [businessId, from, to, excludeAppointmentId ?? null],
  );
  const off = await q.query<{ staff_id: string; starts_at: Date; ends_at: Date }>(
    `select staff_id, starts_at, ends_at from staff_time_off
      where business_id = $1 and starts_at < $3 and ends_at > $2`,
    [businessId, from, to],
  );
  return {
    busy: appts.map((a) => ({ staffId: a.staff_id, start: new Date(a.starts_at), end: new Date(a.ends_at) })),
    timeOff: off.map((a) => ({ staffId: a.staff_id, start: new Date(a.starts_at), end: new Date(a.ends_at) })),
  };
}

export async function getAppointment(q: Queryable, businessId: string, id: string): Promise<AppointmentRow | null> {
  const r = await q.query<AppointmentRow>(`select * from appointments where business_id = $1 and id = $2`, [businessId, id]);
  return r[0] ?? null;
}

export type AppointmentView = AppointmentRow & {
  service_name: string;
  staff_name: string;
  customer_name: string;
  customer_phone: string | null;
};

export async function getAppointmentView(q: Queryable, businessId: string, id: string): Promise<AppointmentView | null> {
  const r = await q.query<AppointmentView>(
    `select a.*, sv.name as service_name, st.name as staff_name, c.name as customer_name, c.phone as customer_phone
       from appointments a
       join services sv on sv.id = a.service_id
       join staff st on st.id = a.staff_id
       join customers c on c.id = a.customer_id
      where a.business_id = $1 and a.id = $2`,
    [businessId, id],
  );
  return r[0] ?? null;
}

export async function getFaqs(q: Queryable, businessId: string) {
  return q.query<{ id: string; question: string; answer: string }>(
    `select id, question, answer from faqs where business_id = $1 order by position, question`,
    [businessId],
  );
}

export async function createIssue(
  q: Queryable,
  i: { businessId: string; kind: string; message: string; callId?: string | null; appointmentId?: string | null },
) {
  await q.query(
    `insert into issues (business_id, kind, message, call_id, appointment_id) values ($1, $2, $3, $4, $5)`,
    [i.businessId, i.kind, i.message.slice(0, 1000), i.callId ?? null, i.appointmentId ?? null],
  );
}
