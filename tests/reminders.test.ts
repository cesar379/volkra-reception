import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { bookAppointment, cancelAppointment, type BookingDeps } from "@/server/booking/service";
import type { EmailMessage } from "@/server/notify";
import { sendReminders } from "@/server/reminders";
import { CLINIC, NOW, STAFF, SVC, freshDb, madrid } from "./helpers";

// Cita el jueves 5 de noviembre de 2026; el recordatorio sale la tarde del miércoles 4.
const THU = "2026-11-05";
const WED_AFTERNOON = madrid("2026-11-04", "17:00");
const ana = { name: "Ana Prueba", phone: "+34000099001", email: "ana@correo.test", emailConsent: true };

let db: Db;
let sent: EmailMessage[];
beforeEach(async () => {
  db = await freshDb();
  sent = [];
});
afterEach(async () => db.close());

const deps = (): BookingDeps => ({ db, now: () => NOW });
const book = (customer = ana, start = "10:00") =>
  bookAppointment(deps(), { businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, start), staffId: STAFF.ortega, customer, source: "ai_call", isSimulated: false });
const toAna = () => sent.filter((m) => m.to === ana.email);
const run = (now = WED_AFTERNOON, fail = false) =>
  sendReminders(db, now, async (m) => {
    if (fail && m.to === ana.email) throw new Error("Resend respondió 500");
    sent.push(m);
  });

describe("Recordatorios por email", () => {
  it("la tarde antes: un email con la cita, el código y cómo cambiarla", async () => {
    const r = await book();
    if (!r.ok) throw new Error(r.message);
    await run();
    expect(toAna()).toHaveLength(1);
    const m = toAna()[0];
    expect(m.subject).toMatch(/Recordatorio: tu cita mañana/);
    expect(m.text).toMatch(/jueves 5 de noviembre, a las 10:00/);
    expect(m.text).toContain(r.appointment.booking_code);
    expect(m.text).toMatch(/cambiarla o cancelarla/);
  });

  it("cada cita recibe un solo recordatorio", async () => {
    await book();
    await run();
    await run();
    expect(toAna()).toHaveLength(1);
  });

  it("no sale si no es el día antes, si se canceló, sin consentimiento o con la opción desactivada", async () => {
    const r = await book();
    if (!r.ok) throw new Error(r.message);
    await run(madrid("2026-11-03", "17:00")); // dos días antes
    expect(toAna()).toHaveLength(0);

    await db.query(`update businesses set reminder_email = false where id = $1`, [CLINIC]);
    await run();
    expect(toAna()).toHaveLength(0);
    await db.query(`update businesses set reminder_email = true where id = $1`, [CLINIC]);

    await cancelAppointment(deps(), { businessId: CLINIC, appointmentId: r.appointment.id, by: "staff" });
    await run();
    expect(toAna()).toHaveLength(0);

    await book({ ...ana, phone: "+34000099002", email: "sin@consentimiento.test", emailConsent: false }, "11:00");
    await run();
    expect(sent.filter((m) => m.to === "sin@consentimiento.test")).toHaveLength(0);
  });

  it("si el envío falla, se puede reintentar", async () => {
    await book();
    expect(await run(WED_AFTERNOON, true)).toMatchObject({ failed: 1 });
    expect(toAna()).toHaveLength(0);
    await run();
    expect(toAna()).toHaveLength(1);
  });
});
