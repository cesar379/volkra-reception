import { DateTime } from "luxon";

export const DEFAULT_TZ = "Europe/Madrid";

/** "HH:MM" o "HH:MM:SS" → minutos desde medianoche */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minutesToHhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Día local (YYYY-MM-DD) + hora local (HH:MM) en una zona → instante UTC */
export function localToDate(day: string, hhmm: string, tz: string): Date {
  const dt = DateTime.fromISO(`${day}T${hhmm.slice(0, 5)}`, { zone: tz });
  if (!dt.isValid) throw new Error(`Fecha u hora no válida: ${day} ${hhmm}`);
  return dt.toJSDate();
}

/** Fecha y hora local sin zona (2026-10-29T17:00) → instante */
export function parseLocalDateTime(value: string, tz: string): Date | null {
  const dt = DateTime.fromISO(value, { zone: tz, setZone: false });
  return dt.isValid ? dt.toJSDate() : null;
}

export function toLocal(date: Date, tz: string): DateTime {
  return DateTime.fromJSDate(date, { zone: tz });
}

export function localDay(date: Date, tz: string): string {
  return toLocal(date, tz).toISODate()!;
}

/** 1 = lunes … 7 = domingo */
export function isoWeekday(day: string, tz: string): number {
  return DateTime.fromISO(day, { zone: tz }).weekday;
}

export function addDays(day: string, n: number, tz: string): string {
  return DateTime.fromISO(day, { zone: tz }).plus({ days: n }).toISODate()!;
}

/** "jueves 29 de octubre" */
export function spokenDay(date: Date, tz: string): string {
  return toLocal(date, tz).setLocale("es").toFormat("cccc d 'de' LLLL");
}

/** "17:00" → "las 17:00"; a la voz se le pasa también la forma hablada. */
export function localTime(date: Date, tz: string): string {
  return toLocal(date, tz).toFormat("HH:mm");
}

/** "a las cinco y media de la tarde" */
export function spokenTime(date: Date, tz: string): string {
  const dt = toLocal(date, tz);
  const h = dt.hour;
  const m = dt.minute;
  const names = ["doce", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once"];
  const h12 = names[h % 12];
  const art = h % 12 === 1 ? "la" : "las";
  let mins = "";
  if (m === 15) mins = " y cuarto";
  else if (m === 30) mins = " y media";
  else if (m === 45) mins = " menos cuarto";
  else if (m !== 0) mins = ` y ${m}`;
  // "menos cuarto" se refiere a la hora siguiente
  let hourName = h12;
  let article = art;
  if (m === 45) {
    hourName = names[(h + 1) % 12];
    article = (h + 1) % 12 === 1 ? "la" : "las";
  }
  const refHour = m === 45 ? h + 1 : h;
  const part = refHour < 13 ? "de la mañana" : refHour < 21 ? "de la tarde" : "de la noche";
  return `a ${article} ${hourName}${mins} ${part}`;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}
