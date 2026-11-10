import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { bookAppointment, cancelAppointment, rescheduleAppointment, type BookingDeps } from "@/server/booking/service";
import { emailNotifier, issueEmailAlert, type EmailMessage } from "@/server/notify";
import { buildIcs } from "@/server/ics";
import { handleVapiMessage } from "@/server/vapi/handler";
import { CLINIC, NOW, STAFF, SVC, freshDb, madrid } from "./helpers";

// Jueves 5 de noviembre de 2026: agenda limpia (fuera de las citas de demo).
const THU = "2026-11-05";
const BIZ_EMAIL = "recepcion@clinica.test";
const withEmail = { name: "Ana Prueba", phone: "+34000099001", email: "ana@correo.test", emailConsent: true };

let db: Db;
let sent: EmailMessage[];
let failTo: string | null;

const notifyDeps = (): BookingDeps => {
  const send = async (m: EmailMessage) => {
    if (m.to === failTo) throw new Error("Resend respondió 500");
    sent.push(m);
  };
  const opts = { send, enabled: () => true, appUrl: () => "https://entrada.volkra.es" };
  return { db, now: () => NOW, notify: emailNotifier(db, { ...opts, from: () => "Volkra <avisos@volkra.es>" }), alert: issueEmailAlert(opts) };
};
const toBusiness = () => sent.filter((m) => m.to === BIZ_EMAIL);
const toCustomer = () => sent.filter((m) => m.to === withEmail.email);
const ics = (m: EmailMessage) => (m.attachments?.[0]?.content ?? "").replace(/\r\n /g, ""); // líneas desplegadas

const book = (d: BookingDeps, source: "ai_call" | "manual" | "simulator" = "ai_call", customer = withEmail) =>
  bookAppointment(d, { businessId: CLINIC, serviceId: SVC.revision, start: madrid(THU, "10:00"), staffId: STAFF.ortega, customer, source, isSimulated: source === "simulator" });

beforeEach(async () => {
  db = await freshDb();
  sent = [];
  failTo = null;
  await db.query(`update businesses set notify_email = $2 where id = $1`, [CLINIC, BIZ_EMAIL]);
});
afterEach(async () => db.close());

describe("avisos de cita a las dos partes", () => {
  it("reserva hecha por el asistente: avisa al negocio y a la persona, con invitación de calendario", async () => {
    const r = await book(notifyDeps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [biz] = toBusiness();
    expect(biz.subject).toMatch(/^Nueva cita: Ana Prueba · Revisión/);
    expect(biz.text).toContain("+34000099001");
    expect(biz.text).toContain("ana@correo.test");
    expect(biz.text).toContain(r.appointment.booking_code);
    expect(biz.text).toContain("https://entrada.volkra.es/agenda");
    expect(biz.replyTo).toBe("ana@correo.test");
    expect(ics(biz)).toContain("METHOD:REQUEST");
    expect(ics(biz)).toContain(`UID:${r.appointment.id}@volkra`);
    expect(ics(biz)).toContain(`ATTENDEE;CN="Clínica Dental Alba"`);
    expect(ics(biz)).toContain("mailto:avisos@volkra.es");
    expect(ics(biz)).not.toContain("+34000099001"); // datos mínimos en el calendario
    expect(ics(biz)).toContain("DTSTART:20261105T090000Z"); // 10:00 en Madrid

    const [cus] = toCustomer();
    expect(cus.subject).toBe("Cita confirmada en Clínica Dental Alba");
    expect(cus.replyTo).toBe(BIZ_EMAIL);
    expect(ics(cus)).toContain(`UID:${r.appointment.id}@volkra`);
    expect(ics(cus)).toContain("mailto:ana@correo.test");
  });

  it("reserva hecha por el equipo desde el panel: solo avisa a la persona", async () => {
    await book(notifyDeps(), "manual");
    expect(toBusiness()).toHaveLength(0);
    expect(toCustomer()).toHaveLength(1);
  });

  it("cambio por el asistente: indica la hora anterior y la invitación mueve el mismo evento", async () => {
    const d = notifyDeps();
    const r = await book(d);
    if (!r.ok) throw new Error("no reservó");
    // Simula que el cambio llega más tarde (la secuencia del calendario crece con updated_at).
    await db.query(`update appointments set updated_at = now() - interval '1 hour' where id = $1`, [r.appointment.id]);
    const firstSeq = Number(ics(toBusiness()[0]).match(/SEQUENCE:(\d+)/)![1]);
    sent = [];

    const m = await rescheduleAppointment(d, { businessId: CLINIC, appointmentId: r.appointment.id, newStart: madrid(THU, "12:00") });
    expect(m.ok).toBe(true);
    const [biz] = toBusiness();
    expect(biz.subject).toMatch(/^Cita cambiada:/);
    expect(biz.text).toMatch(/Antes: .*10:00/);
    expect(ics(biz)).toContain(`UID:${r.appointment.id}@volkra`);
    expect(ics(biz)).toContain("DTSTART:20261105T110000Z");
    expect(Number(ics(biz).match(/SEQUENCE:(\d+)/)![1])).toBeGreaterThanOrEqual(firstSeq);
    expect(toCustomer()[0].subject).toBe("Tu cita en Clínica Dental Alba ha cambiado");
  });

  it("cancelación: la invitación quita el evento del calendario", async () => {
    const d = notifyDeps();
    const r = await book(d);
    if (!r.ok) throw new Error("no reservó");
    sent = [];
    await cancelAppointment(d, { businessId: CLINIC, appointmentId: r.appointment.id });
    for (const m of [toBusiness()[0], toCustomer()[0]]) {
      expect(ics(m)).toContain("METHOD:CANCEL");
      expect(ics(m)).toContain("STATUS:CANCELLED");
    }
    expect(toBusiness()[0].subject).toMatch(/^Cita cancelada:/);
  });

  it("cambio o cancelación desde el panel: avisa solo a la persona", async () => {
    const d = notifyDeps();
    const r = await book(d);
    if (!r.ok) throw new Error("no reservó");
    sent = [];
    await rescheduleAppointment(d, { businessId: CLINIC, appointmentId: r.appointment.id, newStart: madrid(THU, "12:00"), by: "staff" });
    await cancelAppointment(d, { businessId: CLINIC, appointmentId: r.appointment.id, by: "staff" });
    expect(toBusiness()).toHaveLength(0);
    expect(toCustomer()).toHaveLength(2);
  });

  it("sin consentimiento no se escribe a la persona; el negocio sí recibe el aviso", async () => {
    await book(notifyDeps(), "ai_call", { ...withEmail, emailConsent: false });
    expect(toCustomer()).toHaveLength(0);
    expect(toBusiness()).toHaveLength(1);
  });

  it("las citas del simulador no avisan a nadie", async () => {
    await book(notifyDeps(), "simulator");
    expect(sent).toHaveLength(0);
  });

  it("si falla el envío al negocio, la persona recibe igualmente su confirmación", async () => {
    failTo = BIZ_EMAIL;
    const r = await book(notifyDeps());
    expect(r.ok).toBe(true);
    expect(toCustomer()).toHaveLength(1);
  });
});

describe("recado con email", () => {
  it("el asistente pasa el contacto al email del negocio, con respuesta directa a la persona", async () => {
    await db.query(`update businesses set vapi_phone_number_id = 'pn_clinic' where id = $1`, [CLINIC]);
    await handleVapiMessage({ ...notifyDeps(), appUrl: "https://x", webhookSecret: "s" }, {
      message: {
        type: "tool-calls",
        call: { id: "rc1", phoneNumberId: "pn_clinic", customer: { number: "+34000088001" } },
        phoneNumber: { id: "pn_clinic" },
        toolCallList: [{ id: "t-rc1", type: "function", function: { name: "dejar_recado", arguments: { nombre: "Laura Ruiz", motivo: "Presupuesto de ortodoncia", email: "Laura@Correo.test" } } }],
      },
    });
    const [m] = toBusiness();
    expect(m.subject).toBe("Recado de Laura Ruiz – Clínica Dental Alba");
    expect(m.text).toContain("Email: laura@correo.test");
    expect(m.text).toContain("+34000088001");
    expect(m.replyTo).toBe("laura@correo.test");
    const issue = await db.query<{ message: string }>(`select message from issues where business_id = $1 and kind = 'callback_request' order by created_at desc limit 1`, [CLINIC]);
    expect(issue[0].message).toContain("laura@correo.test");
  });
});

describe("invitación iCalendar", () => {
  it("parte las líneas largas a 75 octetos sin romper caracteres y escapa el texto", () => {
    const out = buildIcs({
      uid: "x@volkra", sequence: 1, method: "REQUEST", start: madrid(THU, "10:00"), end: madrid(THU, "10:30"),
      summary: "Revisión; ñandú, ".repeat(10), description: "línea 1\nlínea 2", location: null,
      organizer: { email: "a@b.es", name: "Clínica \"Alba\"" }, attendee: { email: "c@d.es" }, now: NOW,
    });
    for (const line of out.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    const unfolded = out.replace(/\r\n /g, "");
    expect(unfolded).toContain("SUMMARY:Revisión\\; ñandú\\, ");
    expect(unfolded).toContain("DESCRIPTION:línea 1\\nlínea 2");
    expect(unfolded).toContain('ORGANIZER;CN="Clínica Alba":mailto:a@b.es');
  });
});
