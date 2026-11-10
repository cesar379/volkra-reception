import { hhmmToMinutes, isoWeekday, localToDate, minutesToHhmm, overlaps, toLocal } from "./time";

export type HoursRange = { opens: string; closes: string };

export type AvailabilityInput = {
  timezone: string;
  now: Date;
  day: string; // YYYY-MM-DD en la zona del negocio
  service: { id: string; durationMin: number; bufferMin: number };
  staff: { id: string; name: string }[]; // profesionales activos que hacen el servicio
  businessHours: Record<number, HoursRange[]>; // por día ISO 1-7
  specialDay?: { closed: boolean; hours: HoursRange[]; reason: string } | null;
  staffHours: Record<string, Record<number, HoursRange[]> | undefined>;
  timeOff: { staffId: string; start: Date; end: Date }[];
  busy: { staffId: string; start: Date; end: Date }[]; // citas confirmadas + ocupado en calendarios externos
  slotIntervalMin: number;
  minNoticeMin: number;
};

export type Slot = { start: Date; end: Date; blockEnd: Date; staffId: string };

export type DayStatus =
  | { open: true; ranges: HoursRange[] }
  | { open: false; reason: string };

/** Horario efectivo del negocio para un día, teniendo en cuenta festivos y horarios especiales. */
export function dayStatus(input: Pick<AvailabilityInput, "day" | "timezone" | "businessHours" | "specialDay">): DayStatus {
  if (input.specialDay) {
    if (input.specialDay.closed || input.specialDay.hours.length === 0) {
      return { open: false, reason: input.specialDay.reason || "cerrado" };
    }
    return { open: true, ranges: input.specialDay.hours };
  }
  const ranges = input.businessHours[isoWeekday(input.day, input.timezone)] ?? [];
  if (ranges.length === 0) return { open: false, reason: "cerrado ese día de la semana" };
  return { open: true, ranges };
}

function intersect(a: HoursRange[], b: HoursRange[]): [number, number][] {
  const out: [number, number][] = [];
  for (const x of a) {
    for (const y of b) {
      const s = Math.max(hhmmToMinutes(x.opens), hhmmToMinutes(y.opens));
      const e = Math.min(hhmmToMinutes(x.closes), hhmmToMinutes(y.closes));
      if (e > s) out.push([s, e]);
    }
  }
  return out.sort((p, q) => p[0] - q[0]);
}

/**
 * Calcula todos los huecos libres de un día para un servicio.
 * Nunca devuelve un hueco fuera de horario, en festivo, con aviso insuficiente o que se solape
 * con una cita, una ausencia o un bloqueo de calendario externo.
 */
export function computeSlots(input: AvailabilityInput): Slot[] {
  const status = dayStatus(input);
  if (!status.open) return [];

  const weekday = isoWeekday(input.day, input.timezone);
  const earliest = new Date(input.now.getTime() + input.minNoticeMin * 60_000);
  const step = input.slotIntervalMin;
  const dur = input.service.durationMin;
  const block = dur + input.service.bufferMin;
  const slots: Slot[] = [];

  for (const member of input.staff) {
    const schedule = input.staffHours[member.id];
    // Sin horario propio → horario del negocio. Con horario propio → solo sus días y franjas,
    // y siempre dentro del horario del negocio (un festivo cierra para todos).
    const ranges = schedule ? intersect(schedule[weekday] ?? [], status.ranges) : intersect(status.ranges, status.ranges);
    const blockers = [
      ...input.busy.filter((b) => b.staffId === member.id),
      ...input.timeOff.filter((t) => t.staffId === member.id),
    ];

    for (const [open, close] of ranges) {
      for (let m = open; m + dur <= close; m += step) {
        const start = localToDate(input.day, minutesToHhmm(m), input.timezone);
        // DST: si la hora local no existe, luxon la desplaza; la descartamos para no ofrecer horas raras.
        if (toLocal(start, input.timezone).toFormat("HH:mm") !== minutesToHhmm(m)) continue;
        if (start < earliest) continue;
        const end = new Date(start.getTime() + dur * 60_000);
        const blockEnd = new Date(start.getTime() + block * 60_000);
        if (blockers.some((b) => overlaps(start, blockEnd, b.start, b.end))) continue;
        slots.push({ start, end, blockEnd, staffId: member.id });
      }
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime() || a.staffId.localeCompare(b.staffId));
}

export type PartOfDay = "manana" | "tarde" | "noche" | "primera_hora" | "ultima_hora" | "cualquiera";

export type Offer = { start: Date; end: Date; staffIds: string[] };

/** Agrupa huecos por hora de inicio (varios profesionales pueden estar libres a la misma hora). */
export function groupByStart(slots: Slot[]): Offer[] {
  const map = new Map<number, Offer>();
  for (const s of slots) {
    const k = s.start.getTime();
    const o = map.get(k);
    if (o) o.staffIds.push(s.staffId);
    else map.set(k, { start: s.start, end: s.end, staffIds: [s.staffId] });
  }
  return [...map.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function filterPartOfDay(offers: Offer[], part: PartOfDay, tz: string): Offer[] {
  const hour = (o: Offer) => {
    const l = toLocal(o.start, tz);
    return l.hour + l.minute / 60;
  };
  switch (part) {
    case "manana":
      return offers.filter((o) => hour(o) < 14);
    case "tarde":
      return offers.filter((o) => hour(o) >= 14 && hour(o) < 21);
    case "noche":
      return offers.filter((o) => hour(o) >= 19);
    case "primera_hora":
      return offers.slice(0, 3);
    case "ultima_hora":
      return offers.slice(-3);
    default:
      return offers;
  }
}

/**
 * Elige pocas opciones para decir por teléfono: la primera disponible y otras repartidas,
 * en vez de leer una lista larga.
 */
export function pickSpread(offers: Offer[], max = 3): Offer[] {
  if (offers.length <= max) return offers;
  const picked: Offer[] = [];
  const stepIdx = (offers.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) picked.push(offers[Math.round(i * stepIdx)]);
  return picked;
}
