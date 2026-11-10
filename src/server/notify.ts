import type { BookingDeps } from "./booking/service";
import { env, features } from "./env";
import { spokenDay, localTime, toLocal } from "./booking/time";
import type { IssueAlert } from "./agent/alerts";
import { bareEmail, buildIcs, icsSequence } from "./ics";

type NotifyOpts = { send?: (m: EmailMessage) => Promise<void>; enabled?: () => boolean; appUrl?: () => string; from?: () => string };

/**
 * Avisos de cita por correo (Resend) a las dos partes, con invitación de calendario adjunta para que
 * la cita aparezca, se mueva o desaparezca sola en la agenda de quien la recibe:
 *  - a la persona: siempre que dio un email y aceptó recibirlo (base legítima: consentimiento);
 *  - al negocio («Email para avisos»): cuando el cambio no lo hizo el propio equipo desde el panel.
 * Las citas del simulador no avisan a nadie.
 */
export function emailNotifier(db: BookingDeps["db"], opts: NotifyOpts = {}): NonNullable<BookingDeps["notify"]> {
  const send = opts.send ?? resendSend;
  const enabled = opts.enabled ?? (() => features.email);
  const appUrl = opts.appUrl ?? (() => env.APP_URL);
  const from = opts.from ?? (() => env.EMAIL_FROM ?? "");
  return async ({ type, appointment: a, business, by, previousStart }) => {
    if (!enabled() || a.is_simulated) return;
    const c = (await db.query<{ email: string | null; email_consent: boolean; name: string }>(
      `select email, email_consent, name from customers where id = $1`, [a.customer_id],
    ))[0];
    const tz = business.timezone;
    const whenOf = (d: Date) => `${spokenDay(d, tz)} a las ${localTime(d, tz)}`;
    const when = whenOf(new Date(a.starts_at));
    const ics = (attendee: { email: string; name?: string | null }, summary: string, description: string): EmailAttachment => ({
      filename: type === "cancelled" ? "cancelacion.ics" : "cita.ics",
      contentType: `text/calendar; charset=utf-8; method=${type === "cancelled" ? "CANCEL" : "REQUEST"}`,
      content: buildIcs({
        uid: `${a.id}@volkra`,
        sequence: icsSequence(a.updated_at),
        method: type === "cancelled" ? "CANCEL" : "REQUEST",
        start: new Date(a.starts_at),
        end: new Date(a.ends_at),
        summary,
        description,
        location: business.address,
        organizer: { email: bareEmail(from()), name: business.name },
        attendee,
        now: new Date(),
      }),
    });
    const sends: Promise<void>[] = [];

    if (c?.email && c.email_consent) {
      const subject = {
        booked: `Cita confirmada en ${business.name}`,
        rescheduled: `Tu cita en ${business.name} ha cambiado`,
        cancelled: `Cita cancelada en ${business.name}`,
      }[type];
      const contact = [business.public_phone ? `llama al ${business.public_phone}` : "llama al mismo número", business.notify_email ? "o responde a este correo" : ""].filter(Boolean).join(" ");
      const text = [
        `Hola, ${c.name.split(" ")[0]}:`,
        "",
        type === "cancelled"
          ? `Tu cita de ${a.service_name} del ${when} ha quedado cancelada.`
          : `Tu cita de ${a.service_name} es el ${when}, con ${a.staff_name}.`,
        type === "rescheduled" && previousStart ? `(Antes era el ${whenOf(previousStart)}.)` : "",
        type === "cancelled" ? "" : `Código de la cita: ${a.booking_code}`,
        business.address ? `Dirección: ${business.address}` : "",
        "",
        type === "cancelled" ? "" : `Para cambiarla o cancelarla, ${contact}.`,
        type === "cancelled" ? "" : "Adjuntamos la cita para que puedas añadirla a tu calendario.",
        "",
        "Recibes este correo porque pediste la confirmación por email al reservar.",
      ].filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
      sends.push(send({
        to: c.email,
        subject,
        text,
        replyTo: business.notify_email,
        attachments: [ics({ email: c.email, name: c.name }, `${a.service_name} en ${business.name}`, `Con ${a.staff_name}. Código ${a.booking_code}.`)],
      }));
    }

    if (business.notify_email && by === "assistant") {
      const short = `${a.customer_name} · ${a.service_name}, ${spokenDay(new Date(a.starts_at), tz)} ${localTime(new Date(a.starts_at), tz)}`;
      const subject = { booked: `Nueva cita: ${short}`, rescheduled: `Cita cambiada: ${short}`, cancelled: `Cita cancelada: ${short}` }[type];
      const text = [
        { booked: "El asistente ha reservado una cita.", rescheduled: "El asistente ha cambiado una cita a petición de la persona.", cancelled: "El asistente ha cancelado una cita a petición de la persona." }[type],
        "",
        `Persona: ${a.customer_name}`,
        `Teléfono: ${a.customer_phone ?? "no disponible"}`,
        c?.email ? `Email: ${c.email}` : "",
        `Servicio: ${a.service_name}, con ${a.staff_name}`,
        `${type === "rescheduled" ? "Nueva hora" : "Cuándo"}: ${when}`,
        type === "rescheduled" && previousStart ? `Antes: ${whenOf(previousStart)}` : "",
        `Código: ${a.booking_code}`,
        "",
        type === "cancelled" ? "El hueco vuelve a estar libre." : "La invitación adjunta la añade a vuestro calendario; si la cita cambia o se cancela, se actualiza sola.",
        "",
        `Ver la agenda: ${appUrl().replace(/\/$/, "")}/agenda`,
        "",
        "Aviso automático de Volkra Hub.",
      ].filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
      sends.push(send({
        to: business.notify_email,
        subject,
        text,
        replyTo: c?.email ?? null,
        // Datos mínimos en el calendario, como en Google Calendar: sin teléfono ni notas.
        attachments: [ics({ email: business.notify_email, name: business.name }, `${a.service_name} · ${a.customer_name}`, `Reservada por Volkra. Código ${a.booking_code}.`)],
      }));
    }

    // Un envío que falla no impide el otro; el primer error se propaga para que quede registrado.
    const failed = (await Promise.allSettled(sends)).find((r) => r.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
  };
}

export type EmailAttachment = { filename: string; content: string; contentType: string };
export type EmailMessage = { to: string; subject: string; text: string; replyTo?: string | null; attachments?: EmailAttachment[] };

/** Envío por Resend (API REST). */
export async function resendSend(m: EmailMessage): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [m.to],
      subject: m.subject,
      text: m.text,
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      ...(m.attachments?.length
        ? { attachments: m.attachments.map((x) => ({ filename: x.filename, content: Buffer.from(x.content).toString("base64"), content_type: x.contentType })) }
        : {}),
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Resend respondió ${res.status}`);
}

/**
 * Aviso interno al negocio por email: recados y llamadas fallidas.
 * Solo si el negocio configuró un email de avisos. Sin transcripción ni datos innecesarios:
 * nombre, teléfono, motivo (ya limitado por el asistente), fecha/hora y enlace al panel.
 */
export function issueEmailAlert(
  opts: { send?: (m: EmailMessage) => Promise<void>; enabled?: () => boolean; appUrl?: () => string } = {},
): (a: IssueAlert) => Promise<void> {
  const send = opts.send ?? resendSend;
  const enabled = opts.enabled ?? (() => features.email);
  const appUrl = opts.appUrl ?? (() => env.APP_URL);
  return async (a) => {
    if (!a.business.notify_email || !enabled()) return;
    const when = toLocal(a.at, a.business.timezone).setLocale("es").toFormat("cccc d 'de' LLLL, HH:mm");
    const who = a.name?.trim() || "alguien sin identificar";
    const subject = a.kind === "callback_request" ? `Recado de ${who} – ${a.business.name}` : `Llamada fallida – ${a.business.name}`;
    const lines =
      a.kind === "callback_request"
        ? [`${who} ha dejado un recado al asistente y pide que ${a.email && !a.phone ? "le escribáis" : "le llaméis"}.`, "", `Nombre: ${who}`, `Teléfono: ${a.phone ?? "no disponible"}`, ...(a.email ? [`Email: ${a.email} (podéis responder directamente a este correo)`] : []), `Motivo: ${a.reason || "—"}`, `Cuándo: ${when} (hora ${a.business.timezone === "Europe/Madrid" ? "de Madrid" : "local"})`]
        : ["Una llamada al asistente telefónico ha terminado por un fallo técnico.", "", `Teléfono: ${a.phone ?? "no disponible (llamada oculta o sin identificador)"}`, `Detalle: ${a.reason}`, `Cuándo: ${when} (hora ${a.business.timezone === "Europe/Madrid" ? "de Madrid" : "local"})`, "", "Revisad si hay que devolver la llamada."];
    const text = [...lines, "", `Ver en el panel: ${appUrl().replace(/\/$/, "")}/incidencias`, "", "Aviso automático de Volkra Hub."].join("\n");
    await send({ to: a.business.notify_email, subject, text, replyTo: a.email ?? null });
  };
}
