/** Formato de fechas, horas y dinero para la interfaz (siempre en la zona del negocio). */
export const TZ = "Europe/Madrid";

export function fmtDate(d: Date | string, tz = TZ, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: tz, ...opts }).format(new Date(d));
}

export function fmtTime(d: Date | string, tz = TZ) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

export function fmtDateTime(d: Date | string, tz = TZ) {
  return `${fmtDate(d, tz)} · ${fmtTime(d, tz)}`;
}

export function fmtDuration(sec: number | null | undefined) {
  if (sec === null || sec === undefined) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}

export function fmtEuros(cents: number | null, from = false) {
  if (cents === null) return "A consultar";
  if (cents === 0) return "Gratis";
  return `${from ? "desde " : ""}${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: cents % 100 ? 2 : 0 })} €`;
}

export const OUTCOME_LABEL: Record<string, string> = {
  booked: "Cita reservada",
  rescheduled: "Cita cambiada",
  cancelled: "Cita cancelada",
  info: "Información",
  transferred: "Transferida",
  message: "Recado",
  no_action: "Sin acción",
  error: "Error",
};

export const STATUS_LABEL: Record<string, string> = {
  in_progress: "En curso",
  completed: "Atendida por IA",
  transferred: "Transferida",
  failed: "Fallida",
};

export const VERTICALS: Record<string, string> = {
  clinica: "Clínica",
  peluqueria: "Peluquería / estética",
  taller: "Taller",
  academia: "Academia",
  otro: "Otro",
};
