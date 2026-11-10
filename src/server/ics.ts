/**
 * Invitaciones de calendario (iCalendar, RFC 5545) adjuntas a los emails de cita.
 * Gmail, Outlook y Apple Calendar las añaden a la agenda de quien las recibe, y como el UID es siempre
 * el de la cita, un cambio mueve el mismo evento y una cancelación lo quita (SEQUENCE creciente).
 */
export type IcsEvent = {
  uid: string;
  /** Más alto en cada cambio de la misma cita. */
  sequence: number;
  method: "REQUEST" | "CANCEL";
  start: Date;
  end: Date;
  summary: string;
  description: string;
  location?: string | null;
  organizer: { email: string; name: string };
  attendee: { email: string; name?: string | null };
  now: Date;
};

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const param = (s: string) => `"${s.replace(/["\r\n]/g, "")}"`;

/** Líneas de más de 75 octetos se parten con CRLF + espacio, sin cortar caracteres UTF-8. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(e: IcsEvent): string {
  const cancel = e.method === "CANCEL";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Volkra//Hub//ES",
    "CALSCALE:GREGORIAN",
    `METHOD:${e.method}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${stamp(e.now)}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${text(e.summary)}`,
    `DESCRIPTION:${text(e.description)}`,
    ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
    `ORGANIZER;CN=${param(e.organizer.name)}:mailto:${e.organizer.email}`,
    `ATTENDEE;CN=${param(e.attendee.name || e.attendee.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${e.attendee.email}`,
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Secuencia a partir de la última modificación de la cita: crece con cada cambio y cabe en un entero de 32 bits. */
export function icsSequence(updatedAt: Date | string): number {
  return Math.max(0, Math.floor((new Date(updatedAt).getTime() - Date.UTC(2026, 0, 1)) / 1000));
}

/** Dirección pura de un remitente "Nombre <correo@dominio>". */
export function bareEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}
