import type { Queryable } from "./db/client";
import { localTime, spokenDay } from "./booking/time";
import { resendSend, type EmailMessage } from "./notify";

/**
 * Recordatorio por email el día antes de la cita. Solo a quien dio su email y aceptó recibirlo
 * (el mismo consentimiento que la confirmación) y solo si el negocio lo tiene activado.
 * Lo lanza a diario /api/cron/daily. Cada cita recibe como mucho un recordatorio.
 */
type Due = {
  id: string; starts_at: Date; booking_code: string; service_name: string; staff_name: string;
  customer_name: string; email: string; business_name: string; timezone: string; address: string;
  public_phone: string; notify_email: string | null;
};

export async function sendReminders(
  q: Queryable,
  now: Date,
  send: (m: EmailMessage) => Promise<void> = resendSend,
): Promise<{ sent: number; failed: number }> {
  const due = await q.query<Due>(
    `select a.id, a.starts_at, a.booking_code, s.name as service_name, st.name as staff_name, c.name as customer_name, c.email,
            b.name as business_name, b.timezone, b.address, b.public_phone, b.notify_email
       from appointments a
       join businesses b on b.id = a.business_id
       join customers c on c.id = a.customer_id
       join services s on s.id = a.service_id
       join staff st on st.id = a.staff_id
      where a.status = 'confirmed' and not a.is_simulated and a.reminder_sent_at is null
        and b.reminder_email and c.email is not null and c.email_consent
        and (a.starts_at at time zone b.timezone)::date = (($1::timestamptz at time zone b.timezone)::date + 1)
      order by a.starts_at`,
    [now],
  );
  let sent = 0;
  let failed = 0;
  for (const a of due) {
    // Se marca antes de enviar: si el cron coincidiera dos veces, no sale el mismo recordatorio dos veces.
    const claimed = await q.query(`update appointments set reminder_sent_at = $2 where id = $1 and reminder_sent_at is null returning id`, [a.id, now]);
    if (claimed.length === 0) continue;
    try {
      await send(reminderEmail(a));
      sent++;
    } catch (err) {
      failed++;
      await q.query(`update appointments set reminder_sent_at = null where id = $1`, [a.id]);
      console.error("[recordatorio]", a.id, (err as Error).message);
    }
  }
  return { sent, failed };
}

function reminderEmail(a: Due): EmailMessage {
  const start = new Date(a.starts_at);
  const contact = [a.public_phone ? `llama al ${a.public_phone}` : "llámanos", a.notify_email ? "o responde a este correo" : ""].filter(Boolean).join(" ");
  const text = [
    `Hola, ${a.customer_name.split(" ")[0]}:`,
    "",
    `Te recordamos tu cita de ${a.service_name} mañana, ${spokenDay(start, a.timezone)}, a las ${localTime(start, a.timezone)}, con ${a.staff_name}.`,
    a.address ? `Dirección: ${a.address}` : "",
    `Código de la cita: ${a.booking_code}`,
    "",
    `Si no puedes venir, ${contact} para cambiarla o cancelarla y dejar el hueco libre.`,
    "",
    "Recibes este correo porque pediste la confirmación por email al reservar.",
  ].filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
  return { to: a.email, subject: `Recordatorio: tu cita mañana en ${a.business_name}`, text, replyTo: a.notify_email };
}
