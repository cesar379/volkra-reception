import type { Queryable } from "../db/client";
import { dayStatus } from "../booking/availability";
import { getBusinessHours, getSpecialDays, type Business } from "../booking/repo";
import { hhmmToMinutes, localDay, toLocal } from "../booking/time";

/** ¿Está abierto el negocio ahora mismo? (horario, festivos y horarios especiales) */
export async function isOpenNow(q: Queryable, business: Pick<Business, "id" | "timezone">, now: Date): Promise<boolean> {
  const tz = business.timezone;
  const day = localDay(now, tz);
  const [hours, specials] = await Promise.all([getBusinessHours(q, business.id), getSpecialDays(q, business.id, day, day)]);
  const status = dayStatus({ day, timezone: tz, businessHours: hours, specialDay: specials.get(day) ?? null });
  if (!status.open) return false;
  const l = toLocal(now, tz);
  const m = l.hour * 60 + l.minute;
  return status.ranges.some((r) => m >= hhmmToMinutes(r.opens) && m < hhmmToMinutes(r.closes));
}
