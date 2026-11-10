import { DateTime } from "luxon";
import type { PartOfDay } from "./availability";

/**
 * Interpreta expresiones de día habituales en español de España, siempre en la zona del negocio.
 * Es determinista a propósito: el modelo puede pasar el texto tal cual lo dijo el cliente
 * y el servidor decide la fecha, en vez de que la IA "calcule" fechas.
 *
 * Convenciones:
 *  - "el jueves" / "este jueves": el próximo jueves a partir de hoy (hoy incluido si es jueves).
 *  - "el jueves que viene" / "el próximo jueves": el primer jueves estrictamente después de hoy.
 *  - "el jueves de la semana que viene": el jueves de la semana siguiente (lunes a domingo).
 *  - "la semana que viene": lunes de la semana siguiente, marcado como búsqueda flexible.
 * El agente siempre repite la fecha completa ("el jueves 29 de octubre") antes de confirmar.
 */

export type DayParse =
  | { ok: true; day: string; flexibleDays: number; matched: string }
  | { ok: false; reason: string };

const WEEKDAYS: Record<string, number> = {
  lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7,
};
const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¿?¡!.,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDay(text: string, now: Date, tz: string): DayParse {
  const t = normalize(text);
  const today = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
  const iso = (d: DateTime) => d.toISODate()!;

  // ISO explícita
  const isoMatch = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const d = DateTime.fromISO(isoMatch[0], { zone: tz });
    return d.isValid ? { ok: true, day: iso(d), flexibleDays: 0, matched: isoMatch[0] } : { ok: false, reason: "fecha no válida" };
  }

  if (/\bpasado manana\b/.test(t)) return { ok: true, day: iso(today.plus({ days: 2 })), flexibleDays: 0, matched: "pasado mañana" };
  // "mañana" como día, pero no "por la mañana" / "de la mañana" / "esta mañana"
  const withoutPart = t.replace(/\b(por|de|a|esta|la) (la )?manana\b/g, " ");
  if (/\bmanana\b/.test(withoutPart)) return { ok: true, day: iso(today.plus({ days: 1 })), flexibleDays: 0, matched: "mañana" };
  if (/\b(hoy|esta tarde|esta manana|esta noche|ahora)\b/.test(t)) return { ok: true, day: iso(today), flexibleDays: 0, matched: "hoy" };

  // dd/mm(/aaaa)
  const slash = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) return fromDayMonth(Number(slash[1]), Number(slash[2]), slash[3] ? Number(slash[3]) : undefined, today, tz);

  // "15 de noviembre", "el 3 de diciembre de 2026"
  const dm = t.match(/\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?: de (\d{4}))?\b/);
  if (dm) return fromDayMonth(Number(dm[1]), MONTHS[dm[2]], dm[3] ? Number(dm[3]) : undefined, today, tz);

  // Día de la semana
  const wd = t.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (wd) {
    const target = WEEKDAYS[wd[1]];
    const nextWeek = /\b(de|la) (la )?semana que viene\b|\bde la proxima semana\b|\bsemana proxima\b/.test(t);
    const strictlyAfter = /\bque viene\b|\bproximo\b|\bsiguiente\b/.test(t);
    let d: DateTime;
    if (nextWeek) {
      d = today.startOf("week").plus({ weeks: 1 }).plus({ days: target - 1 });
    } else {
      let diff = (target - today.weekday + 7) % 7;
      if (diff === 0 && strictlyAfter) diff = 7;
      if (diff === 0 && !/\beste\b|\bhoy\b/.test(t)) diff = 7; // "el jueves" dicho un jueves → el de la semana siguiente
      d = today.plus({ days: diff });
    }
    return { ok: true, day: iso(d), flexibleDays: 0, matched: wd[0] };
  }

  if (/\b(la )?semana que viene\b|\bproxima semana\b/.test(t)) {
    return { ok: true, day: iso(today.startOf("week").plus({ weeks: 1 })), flexibleDays: 6, matched: "la semana que viene" };
  }
  if (/\besta semana\b/.test(t)) {
    const end = today.endOf("week");
    return { ok: true, day: iso(today), flexibleDays: Math.round(end.diff(today, "days").days), matched: "esta semana" };
  }
  if (/\b(cuanto antes|lo antes posible|primer hueco|cuando (sea|haya)|cuando (a ti |a usted )?(te |le |os )?(venga|vaya) bien)\b/.test(t)) {
    return { ok: true, day: iso(today), flexibleDays: 13, matched: "lo antes posible" };
  }

  // "el día 15", "el 15"
  const dayOnly = t.match(/\b(?:el )?(?:dia )?(\d{1,2})\b/);
  if (dayOnly && Number(dayOnly[1]) >= 1 && Number(dayOnly[1]) <= 31 && /\b(el|dia)\b/.test(t)) {
    let d = today.set({ day: Number(dayOnly[1]) });
    if (!d.isValid || d < today) d = today.plus({ months: 1 }).set({ day: Number(dayOnly[1]) });
    if (d.isValid) return { ok: true, day: iso(d), flexibleDays: 0, matched: dayOnly[0] };
  }

  return { ok: false, reason: "no he entendido el día" };
}

function fromDayMonth(day: number, month: number, year: number | undefined, today: DateTime, tz: string): DayParse {
  let y = year !== undefined ? (year < 100 ? 2000 + year : year) : today.year;
  let d = DateTime.fromObject({ year: y, month, day }, { zone: tz });
  if (!d.isValid) return { ok: false, reason: "esa fecha no existe" };
  if (year === undefined && d < today) {
    y += 1;
    d = DateTime.fromObject({ year: y, month, day }, { zone: tz });
  }
  return { ok: true, day: d.toISODate()!, flexibleDays: 0, matched: `${day}/${month}` };
}

export function parsePartOfDay(text: string | undefined | null): PartOfDay {
  if (!text) return "cualquiera";
  const t = normalize(text);
  if (/\b(ultima hora|a ultima|lo mas tarde|al final del dia)\b/.test(t)) return "ultima_hora";
  if (/\b(primera hora|a primera|lo mas temprano|nada mas abrir)\b/.test(t)) return "primera_hora";
  if (/\b(por la |de la |esta )?noche\b/.test(t)) return "noche";
  if (/\b(por la |de la |esta )?tarde\b|\bdespues de comer\b/.test(t)) return "tarde";
  if (/\b(por la |de la |esta )manana\b|^manana$|\bmediodia\b/.test(t)) return "manana";
  if (t === "manana" || t === "tarde" || t === "noche" || t === "primera_hora" || t === "ultima_hora") return t as PartOfDay;
  return "cualquiera";
}
