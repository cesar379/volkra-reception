import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import {
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  retryPendingCalendarSyncs,
  searchAvailability,
} from "@/server/booking/service";
import { CLINIC, STAFF, SVC, deps, fakeCalendar, freshDb, madrid } from "./helpers";

const customer = { name: "Ana Prueba", phone: "+34000099001" };
// Jueves 5 de noviembre de 2026: fuera del rango de citas de demo (próximos 8 días), agenda limpia.
const THU = "2026-11-05";
const FRI = "2026-11-06";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

describe("reservas", () => {
  it("reserva en un horario disponible y la guarda confirmada", async () => {
    const r = await bookAppointment(deps(db), {
      businessId: CLINIC, serviceId: SVC.limpieza, start: madrid(THU, "10:00"), customer, source: "ai_call",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.appointment.status).toBe("confirmed");
    expect(r.appointment.booking_code).toMatch(/^[A-Z2-9]{6}$/);
    expect([STAFF.gil, STAFF.ortega]).toContain(r.appointment.staff_id);
    const rows = await db.query<{ n: number }>(`select count(*)::int n from appointments where id = $1 and status = 'confirmed'`, [r.appointment.id]);
    expect(rows[0].n).toBe(1);
  });

  it("rechaza un horario ocupado y ofrece alternativas reales", async () => {
    const first = await bookAppointment(deps(db), {
      businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "17:00"), staffId: STAFF.ortega, customer, source: "ai_call",
    });
    expect(first.ok).toBe(true);
    const second = await bookAppointment(deps(db), {
      businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "17:00"), staffId: STAFF.ortega,
      customer: { name: "Otro Cliente", phone: "+34000099002" }, source: "ai_call",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("slot_unavailable");
    expect(second.alternatives?.status).toBe("ok");
    if (second.alternatives?.status === "ok") {
      for (const o of second.alternatives.offers) expect(o.start.getTime()).not.toBe(madrid(THU, "17:00").getTime());
    }
  });

  it("intentos simultáneos sobre el mismo hueco: solo uno gana", async () => {
    const attempts = Array.from({ length: 6 }, (_, i) =>
      bookAppointment(deps(db), {
        businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "18:00"), staffId: STAFF.ortega,
        customer: { name: `Cliente ${i}`, phone: `+3400009910${i}` }, source: "ai_call",
      }),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const n = await db.query<{ n: number }>(
      `select count(*)::int n from appointments where staff_id = $1 and starts_at = $2 and status = 'confirmed'`,
      [STAFF.ortega, madrid(THU, "18:00")],
    );
    expect(n[0].n).toBe(1);
  });

  it("intentos simultáneos sin preferencia de profesional: se reparten y nunca hay solape", async () => {
    // Viernes por la tarde la revisión la pueden hacer la Dra. Ortega y el Dr. Salas → máximo 2 reservas a las 17:00
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        bookAppointment(deps(db), {
          businessId: CLINIC, serviceId: SVC.revision, start: madrid(FRI, "17:00"),
          customer: { name: `Cliente ${i}`, phone: `+3400009920${i}` }, source: "ai_call",
        }),
      ),
    );
    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(2);
    const staffIds = ok.map((r) => (r.ok ? r.appointment.staff_id : "")).sort();
    expect(staffIds).toEqual([STAFF.ortega, STAFF.salas].sort());
  });

  it("la base de datos impide solapes aunque se salte la capa de aplicación", async () => {
    const r = await bookAppointment(deps(db), {
      businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "12:00"), staffId: STAFF.ortega, customer, source: "manual",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await expect(
      db.query(
        `insert into appointments (business_id, service_id, staff_id, customer_id, starts_at, ends_at, booking_code)
         values ($1,$2,$3,$4,$5,$6,'ZZZZZZ')`,
        [CLINIC, SVC.revision, STAFF.ortega, r.appointment.customer_id, madrid(THU, "12:15"), madrid(THU, "12:45")],
      ),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("modifica una cita y libera el hueco anterior", async () => {
    const r = await bookAppointment(deps(db), {
      businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "10:00"), staffId: STAFF.ortega, customer, source: "ai_call",
    });
    if (!r.ok) throw new Error("setup");
    const m = await rescheduleAppointment(deps(db), { businessId: CLINIC, appointmentId: r.appointment.id, newStart: madrid(THU, "12:30") });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(new Date(m.appointment.starts_at).getTime()).toBe(madrid(THU, "12:30").getTime());
    expect(m.appointment.staff_id).toBe(STAFF.ortega); // mantiene profesional si puede
    const again = await bookAppointment(deps(db), {
      businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "10:00"), staffId: STAFF.ortega,
      customer: { name: "Otra Persona", phone: "+34000099003" }, source: "ai_call",
    });
    expect(again.ok).toBe(true);
  });

  it("no permite mover una cita a un hueco ocupado", async () => {
    const a = await bookAppointment(deps(db), { businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "10:00"), staffId: STAFF.ortega, customer, source: "manual" });
    const b = await bookAppointment(deps(db), { businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "11:00"), staffId: STAFF.ortega, customer: { name: "Pepe", phone: "+34000099004" }, source: "manual" });
    if (!a.ok || !b.ok) throw new Error("setup");
    const m = await rescheduleAppointment(deps(db), { businessId: CLINIC, appointmentId: a.appointment.id, newStart: madrid(THU, "11:00"), staffId: STAFF.ortega });
    expect(m.ok).toBe(false);
  });

  it("cancela una cita, libera el hueco y es idempotente", async () => {
    const r = await bookAppointment(deps(db), { businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "10:00"), staffId: STAFF.ortega, customer, source: "ai_call" });
    if (!r.ok) throw new Error("setup");
    const c1 = await cancelAppointment(deps(db), { businessId: CLINIC, appointmentId: r.appointment.id, reason: "viaje" });
    expect(c1.ok && c1.appointment.status).toBe("cancelled");
    const c2 = await cancelAppointment(deps(db), { businessId: CLINIC, appointmentId: r.appointment.id });
    expect(c2.ok && c2.alreadyCancelled).toBe(true);
    const s = await searchAvailability(deps(db), { businessId: CLINIC, serviceId: SVC.revision, day: THU, staffId: STAFF.ortega, maxOffers: 100 });
    expect(s.status).toBe("ok");
    if (s.status === "ok") expect(s.offers.some((o) => o.start.getTime() === madrid(THU, "10:00").getTime())).toBe(true);
  });
});

describe("horarios", () => {
  it("fuera de horario: domingo, festivo, noche y hora de comer", async () => {
    const sunday = await searchAvailability(deps(db), { businessId: CLINIC, serviceId: SVC.revision, day: "2026-11-08" });
    expect(sunday.status).toBe("closed");
    const festivo = await searchAvailability(deps(db), { businessId: CLINIC, serviceId: SVC.revision, day: "2026-11-09" });
    expect(festivo.status).toBe("closed");
    if (festivo.status === "closed") {
      expect(festivo.reason).toMatch(/Almudena/);
      expect(festivo.nextOffers.length).toBeGreaterThan(0); // propone alternativa
    }
    for (const [day, t] of [["2026-11-08", "11:00"], [THU, "21:00"], [THU, "14:30"], [THU, "08:00"]]) {
      const r = await bookAppointment(deps(db), { businessId: CLINIC, serviceId: SVC.revision, start: madrid(day, t), customer, source: "ai_call" });
      expect(r.ok, `${day} ${t}`).toBe(false);
    }
  });

  it("horario especial (Nochebuena 10:00-13:00) y aviso mínimo", async () => {
    await db.query(`update businesses set max_days_ahead = 120 where id = $1`, [CLINIC]);
    const s = await searchAvailability(deps(db), { businessId: CLINIC, serviceId: SVC.revision, day: "2026-12-24", maxOffers: 100 });
    expect(s.status).toBe("ok");
    if (s.status === "ok") {
      const last = s.offers[s.offers.length - 1];
      expect(last.end.getTime()).toBeLessThanOrEqual(madrid("2026-12-24", "13:00").getTime());
    }
    // Hoy a las 10:00 con 60 min de aviso: nada antes de las 11:00
    const today = await searchAvailability(deps(db), { businessId: CLINIC, serviceId: SVC.revision, day: "2026-10-22", maxOffers: 100 });
    if (today.status === "ok") for (const o of today.offers) expect(o.start.getTime()).toBeGreaterThanOrEqual(madrid("2026-10-22", "11:00").getTime());
  });

  it("servicios de distinta duración: la endodoncia (90 min + 15 de margen) solo cabe donde hay hueco", async () => {
    const s = await searchAvailability(deps(db), { businessId: CLINIC, serviceId: SVC.endodoncia, day: FRI, maxOffers: 100 });
    expect(s.status).toBe("ok");
    if (s.status !== "ok") return;
    for (const o of s.offers) {
      const endMorning = madrid(FRI, "14:00").getTime();
      const endAfternoon = madrid(FRI, "20:30").getTime();
      const inMorning = o.start.getTime() < endMorning;
      expect(o.end.getTime()).toBeLessThanOrEqual(inMorning ? endMorning : endAfternoon);
      expect(o.staffIds).toEqual([STAFF.salas]);
    }
    // Una revisión de 30 min a las 11:00 con el Dr. Salas impide empezar una endodoncia a las 9:30 (terminaría 11:00 + 15 de margen)
    await bookAppointment(deps(db), { businessId: CLINIC, serviceId: SVC.revision, start: madrid(FRI, "11:00"), staffId: STAFF.salas, customer, source: "manual" });
    const endo = await bookAppointment(deps(db), { businessId: CLINIC, serviceId: SVC.endodoncia, start: madrid(FRI, "09:30"), customer: { name: "Luis", phone: "+34000099005" }, source: "manual" });
    expect(endo.ok).toBe(false);
    const shorter = await bookAppointment(deps(db), { businessId: CLINIC, serviceId: SVC.revision, start: madrid(FRI, "09:30"), staffId: STAFF.salas, customer: { name: "Luis", phone: "+34000099005" }, source: "manual" });
    expect(shorter.ok).toBe(true);
  });

  it("el profesional solo trabaja sus días (Dr. Salas no trabaja los jueves)", async () => {
    const s = await searchAvailability(deps(db), { businessId: CLINIC, serviceId: SVC.endodoncia, day: THU });
    expect(s.status).not.toBe("ok");
  });
});

describe("idempotencia", () => {
  it("la misma petición repetida no duplica la cita", async () => {
    const p = { businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "10:00"), customer, source: "ai_call" as const, idempotencyKey: "toolcall_123" };
    const a = await bookAppointment(deps(db), p);
    const b = await bookAppointment(deps(db), p);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.appointment.id).toBe(a.appointment.id);
    expect(b.replayed).toBe(true);
    const n = await db.query<{ n: number }>(`select count(*)::int n from appointments where idempotency_key = 'toolcall_123'`);
    expect(n[0].n).toBe(1);
  });
});

describe("Google Calendar", () => {
  async function connectCalendar() {
    await db.query(`update businesses set google_connected = true, google_calendar_id = 'clinica@group.calendar.google.com' where id = $1`, [CLINIC]);
  }

  it("si Google Calendar falla al crear el evento, la cita queda guardada y se marca para revisar y reintentar", async () => {
    await connectCalendar();
    const r = await bookAppointment(deps(db, { calendar: fakeCalendar({ failWrite: true }) }), {
      businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "10:00"), customer, source: "ai_call",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.calendar).toBe("failed");
    const row = await db.query<{ status: string; gcal_sync_status: string }>(`select status, gcal_sync_status from appointments where id = $1`, [r.appointment.id]);
    expect(row[0]).toEqual({ status: "confirmed", gcal_sync_status: "failed" });
    const issues = await db.query<{ n: number }>(`select count(*)::int n from issues where appointment_id = $1 and kind = 'calendar_sync'`, [r.appointment.id]);
    expect(issues[0].n).toBe(1);

    const cal = fakeCalendar();
    const retry = await retryPendingCalendarSyncs(deps(db, { calendar: cal }));
    expect(retry.synced).toBeGreaterThanOrEqual(1);
    const after = await db.query<{ gcal_sync_status: string; gcal_event_id: string }>(`select gcal_sync_status, gcal_event_id from appointments where id = $1`, [r.appointment.id]);
    expect(after[0].gcal_sync_status).toBe("synced");
    expect(cal.events.has(after[0].gcal_event_id)).toBe(true);
  });

  it("si Google Calendar no responde al buscar huecos, se usan los de la agenda propia y se avisa", async () => {
    await connectCalendar();
    await db.query(`update staff set google_calendar_id = 'ortega@example.com' where id = $1`, [STAFF.ortega]);
    const s = await searchAvailability(deps(db, { calendar: fakeCalendar({ failBusy: true }) }), { businessId: CLINIC, serviceId: SVC.revision, day: THU });
    expect(s.status).toBe("ok");
    if (s.status === "ok") expect(s.externalCalendarChecked).toBe(false);
    const issues = await db.query<{ n: number }>(`select count(*)::int n from issues where business_id = $1 and kind = 'calendar_sync'`, [CLINIC]);
    expect(issues[0].n).toBeGreaterThan(0);
  });

  it("con calendario conectado, la cita se crea como evento", async () => {
    await connectCalendar();
    const cal = fakeCalendar();
    const r = await bookAppointment(deps(db, { calendar: cal }), { businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "10:00"), customer, source: "ai_call" });
    expect(r.ok && r.calendar).toBe("synced");
    expect(cal.events.size).toBe(1);
    if (r.ok) {
      await cancelAppointment(deps(db, { calendar: cal }), { businessId: CLINIC, appointmentId: r.appointment.id });
      expect(cal.events.size).toBe(0);
    }
  });
});

describe("adaptador Postgres (producción)", () => {
  it("los parámetros jsonb ya serializados no se vuelven a serializar", async () => {
    const { serializeJsonParam } = await import("@/server/db/client");
    expect(serializeJsonParam('{"ok":true}')).toBe('{"ok":true}');
    expect(serializeJsonParam({ ok: true })).toBe('{"ok":true}');
    expect(serializeJsonParam([{ opens: "10:00" }])).toBe('[{"opens":"10:00"}]');
  });
});
