import crypto from "node:crypto";
import type { Db, Queryable } from "../db/client";
import { isExclusionViolation, isUniqueViolation } from "../db/client";
import type { CalendarPort } from "../calendar/types";
import { computeSlots, dayStatus, filterPartOfDay, groupByStart, pickSpread, type Offer, type PartOfDay, type Slot } from "./availability";
import {
  createIssue,
  getAppointmentView,
  getBusiness,
  getBusinessHours,
  getBusyFromDb,
  getSpecialDays,
  getStaffHours,
  staffForService,
  type AppointmentView,
  type Business,
  type Service,
  type Staff,
} from "./repo";
import { addDays, localDay, localToDate } from "./time";

export type BookingDeps = {
  db: Db;
  now: () => Date;
  calendar?: CalendarPort | null;
  /** Aviso de cita. by: quién hizo el cambio (el asistente, o el equipo desde el panel). */
  notify?: (event: {
    type: "booked" | "rescheduled" | "cancelled";
    appointment: AppointmentView;
    business: Business;
    by: ChangedBy;
    previousStart?: Date;
  }) => Promise<void>;
  /** Avisos internos al negocio (recados, llamadas fallidas). */
  alert?: (a: import("../agent/alerts").IssueAlert) => Promise<void>;
};

export type ChangedBy = "assistant" | "staff";

export type SearchParams = {
  businessId: string;
  serviceId: string;
  day: string; // YYYY-MM-DD local
  flexibleDays?: number; // buscar también en los N días siguientes
  part?: PartOfDay;
  staffId?: string | null;
  excludeAppointmentId?: string;
  maxOffers?: number;
  callId?: string | null;
};

export type SearchResult =
  | { status: "ok"; day: string; offers: (Offer & { staff: { id: string; name: string }[] })[]; externalCalendarChecked: boolean }
  | { status: "closed"; day: string; reason: string; nextOffers: (Offer & { staff: { id: string; name: string }[] })[] }
  | { status: "full"; day: string; nextOffers: (Offer & { staff: { id: string; name: string }[] })[] }
  | { status: "error"; code: "service_not_found" | "no_staff" | "too_far" | "past_day"; message: string };

type DayData = {
  business: Business;
  service: Service;
  staff: Staff[];
};

async function loadService(q: Queryable, businessId: string, serviceId: string): Promise<Service | null> {
  const r = await q.query<Service>(
    `select id, name, description, duration_min, buffer_min, price_cents, price_from, active
       from services where business_id = $1 and id = $2 and active`,
    [businessId, serviceId],
  );
  return r[0] ?? null;
}

/** Huecos reales de un día concreto (agenda + ausencias + calendarios externos). */
async function slotsForDay(
  deps: BookingDeps,
  data: DayData,
  day: string,
  opts: { staffId?: string | null; excludeAppointmentId?: string; callId?: string | null },
): Promise<{ slots: Slot[]; closedReason?: string; externalChecked: boolean }> {
  const { business, service } = data;
  const tz = business.timezone;
  const staff = opts.staffId ? data.staff.filter((s) => s.id === opts.staffId) : data.staff;
  const q = deps.db;
  const [hours, staffHours, specials] = await Promise.all([
    getBusinessHours(q, business.id),
    getStaffHours(q, business.id),
    getSpecialDays(q, business.id, day, day),
  ]);
  const special = specials.get(day) ?? null;
  const status = dayStatus({ day, timezone: tz, businessHours: hours, specialDay: special });
  if (!status.open) return { slots: [], closedReason: status.reason, externalChecked: true };

  const from = localToDate(day, "00:00", tz);
  const to = localToDate(addDays(day, 1, tz), "00:00", tz);
  const { busy, timeOff } = await getBusyFromDb(q, business.id, from, to, opts.excludeAppointmentId);

  let externalChecked = true;
  const withCalendar = staff.filter((s) => s.google_calendar_id).map((s) => ({ id: s.id, calendarId: s.google_calendar_id!, timezone: tz }));
  if (deps.calendar && business.google_connected && withCalendar.length > 0) {
    try {
      busy.push(...(await deps.calendar.busy({ businessId: business.id, staff: withCalendar, from, to })));
    } catch (err) {
      // El calendario externo no responde: seguimos con la agenda propia (fuente de verdad) y avisamos para revisar.
      externalChecked = false;
      await createIssue(q, {
        businessId: business.id,
        kind: "calendar_sync",
        message: `No se pudo consultar Google Calendar al buscar huecos (${(err as Error).message}). Se ofrecieron huecos según la agenda de Volkra.`,
        callId: opts.callId,
      });
    }
  }

  const slots = computeSlots({
    timezone: tz,
    now: deps.now(),
    day,
    service: { id: service.id, durationMin: service.duration_min, bufferMin: service.buffer_min },
    staff: staff.map((s) => ({ id: s.id, name: s.name })),
    businessHours: hours,
    specialDay: special,
    staffHours,
    timeOff,
    busy,
    slotIntervalMin: business.slot_interval_min,
    minNoticeMin: business.min_notice_min,
  });
  return { slots, externalChecked };
}

function decorate(offers: Offer[], staff: Staff[]) {
  const byId = new Map(staff.map((s) => [s.id, s]));
  return offers.map((o) => ({ ...o, staff: o.staffIds.map((id) => ({ id, name: byId.get(id)?.name ?? "" })) }));
}

export async function searchAvailability(deps: BookingDeps, p: SearchParams): Promise<SearchResult> {
  const business = await getBusiness(deps.db, p.businessId);
  if (!business) return { status: "error", code: "service_not_found", message: "Negocio no encontrado" };
  const service = await loadService(deps.db, p.businessId, p.serviceId);
  if (!service) return { status: "error", code: "service_not_found", message: "Ese servicio no existe o no está activo" };
  const staff = await staffForService(deps.db, p.businessId, p.serviceId);
  if (staff.length === 0) return { status: "error", code: "no_staff", message: "Nadie del equipo tiene asignado este servicio" };

  const tz = business.timezone;
  const today = localDay(deps.now(), tz);
  if (p.day < today) return { status: "error", code: "past_day", message: "Ese día ya ha pasado" };
  const lastDay = addDays(today, business.max_days_ahead, tz);
  if (p.day > lastDay) return { status: "error", code: "too_far", message: `Solo se puede reservar con ${business.max_days_ahead} días de antelación como máximo` };

  const data: DayData = { business, service, staff };
  const part = p.part ?? "cualquiera";
  const max = p.maxOffers ?? 3;
  const span = Math.max(0, p.flexibleDays ?? 0);

  let firstClosed: string | undefined;
  let externalChecked = true;
  for (let i = 0; i <= span; i++) {
    const day = addDays(p.day, i, tz);
    if (day > lastDay) break;
    const r = await slotsForDay(deps, data, day, { staffId: p.staffId, excludeAppointmentId: p.excludeAppointmentId, callId: p.callId });
    externalChecked &&= r.externalChecked;
    if (r.closedReason && i === 0) firstClosed = r.closedReason;
    const offers = filterPartOfDay(groupByStart(r.slots), part, tz);
    if (offers.length > 0 && (i > 0 || !firstClosed)) {
      return { status: "ok", day, offers: decorate(pickSpread(offers, max), staff), externalCalendarChecked: externalChecked };
    }
  }

  // Nada ese día: proponer los primeros huecos de los días siguientes (sin filtro de franja si no hay nada en ella).
  const nextOffers = await nextAvailable(deps, data, addDays(p.day, span + 1, tz), lastDay, part, p);
  if (firstClosed) return { status: "closed", day: p.day, reason: firstClosed, nextOffers };
  return { status: "full", day: p.day, nextOffers };
}

async function nextAvailable(deps: BookingDeps, data: DayData, fromDay: string, lastDay: string, part: PartOfDay, p: SearchParams) {
  const tz = data.business.timezone;
  for (let i = 0; i < 14; i++) {
    const day = addDays(fromDay, i, tz);
    if (day > lastDay) break;
    const r = await slotsForDay(deps, data, day, { staffId: p.staffId, excludeAppointmentId: p.excludeAppointmentId, callId: p.callId });
    const grouped = groupByStart(r.slots);
    const inPart = filterPartOfDay(grouped, part, tz);
    const pool = inPart.length > 0 ? inPart : grouped;
    if (pool.length > 0) return decorate(pickSpread(pool, 2), data.staff);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Reservar
// ---------------------------------------------------------------------------

export type BookParams = {
  businessId: string;
  serviceId: string;
  start: Date;
  staffId?: string | null; // null = cualquiera
  customer: { name: string; phone?: string | null; email?: string | null; emailConsent?: boolean };
  source: "ai_call" | "manual" | "simulator";
  callId?: string | null;
  idempotencyKey?: string | null;
  isSimulated?: boolean;
  notes?: string;
};

export type BookResult =
  | { ok: true; appointment: AppointmentView; replayed: boolean; calendar: "synced" | "failed" | "not_configured" }
  | { ok: false; code: "slot_unavailable" | "slot_taken" | "service_not_found" | "invalid_customer"; message: string; alternatives: SearchResult | null };

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newBookingCode(): string {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (!d.startsWith("+") && d.length === 9) d = "+34" + d; // número español sin prefijo
  if (!d.startsWith("+")) d = "+" + d;
  return /^\+\d{8,15}$/.test(d) ? d : null;
}

async function upsertCustomer(q: Queryable, businessId: string, c: BookParams["customer"]): Promise<string> {
  const phone = normalizePhone(c.phone);
  const name = c.name.trim().slice(0, 120);
  const email = c.email?.trim().toLowerCase() || null;
  if (phone) {
    const r = await q.query<{ id: string }>(
      `insert into customers (business_id, name, phone, email, email_consent)
       values ($1, $2, $3, $4, $5)
       on conflict (business_id, phone) do update
         set name = excluded.name,
             email = coalesce(excluded.email, customers.email),
             email_consent = customers.email_consent or excluded.email_consent
       returning id`,
      [businessId, name, phone, email, Boolean(c.emailConsent && email)],
    );
    return r[0].id;
  }
  const r = await q.query<{ id: string }>(
    `insert into customers (business_id, name, email, email_consent) values ($1, $2, $3, $4) returning id`,
    [businessId, name, email, Boolean(c.emailConsent && email)],
  );
  return r[0].id;
}

/**
 * Reserva con doble verificación:
 *  1) el hueco se recalcula en el momento (nunca se confía en lo que dijo la IA);
 *  2) la base de datos impide solapes aunque dos llamadas reserven a la vez (restricción de exclusión).
 * Solo devuelve ok cuando la cita está guardada.
 */
export async function bookAppointment(deps: BookingDeps, p: BookParams): Promise<BookResult> {
  if (!p.customer.name || p.customer.name.trim().length < 2) {
    return { ok: false, code: "invalid_customer", message: "Falta el nombre de la persona", alternatives: null };
  }
  if (p.idempotencyKey) {
    const prev = await deps.db.query<{ id: string }>(
      `select id from appointments where business_id = $1 and idempotency_key = $2`,
      [p.businessId, p.idempotencyKey],
    );
    if (prev[0]) {
      const appt = (await getAppointmentView(deps.db, p.businessId, prev[0].id))!;
      return { ok: true, appointment: appt, replayed: true, calendar: syncState(appt) };
    }
  }

  const business = await getBusiness(deps.db, p.businessId);
  const service = business ? await loadService(deps.db, p.businessId, p.serviceId) : null;
  if (!business || !service) return { ok: false, code: "service_not_found", message: "Ese servicio no existe", alternatives: null };
  const staff = await staffForService(deps.db, p.businessId, p.serviceId);
  const tz = business.timezone;
  const day = localDay(p.start, tz);

  const { slots } = await slotsForDay(deps, { business, service, staff }, day, { staffId: p.staffId, callId: p.callId });
  const matching = slots.filter((s) => s.start.getTime() === p.start.getTime());
  if (matching.length === 0) {
    const alternatives = await searchAvailability(deps, { businessId: p.businessId, serviceId: p.serviceId, day, staffId: p.staffId, callId: p.callId });
    return { ok: false, code: "slot_unavailable", message: "Esa hora no está disponible", alternatives };
  }

  // Si da igual el profesional, primero quien menos citas tiene ese día (reparto de carga).
  const load = await deps.db.query<{ staff_id: string; n: number }>(
    `select staff_id, count(*)::int as n from appointments
      where business_id = $1 and status = 'confirmed' and starts_at >= $2 and starts_at < $3 group by staff_id`,
    [p.businessId, localToDate(day, "00:00", tz), localToDate(addDays(day, 1, tz), "00:00", tz)],
  );
  const loadMap = new Map(load.map((l) => [l.staff_id, l.n]));
  const candidates = [...matching].sort((a, b) => (loadMap.get(a.staffId) ?? 0) - (loadMap.get(b.staffId) ?? 0));

  let createdId: string | null = null;
  const insertOnce = (slot: Slot) =>
    deps.db.tx(async (q) => {
      const customerId = await upsertCustomer(q, p.businessId, p.customer);
      const r = await q.query<{ id: string }>(
        `insert into appointments (business_id, service_id, staff_id, customer_id, starts_at, ends_at, status, source,
                                   booking_code, notes, call_id, idempotency_key, is_simulated, gcal_sync_status)
         values ($1,$2,$3,$4,$5,$6,'confirmed',$7,$8,$9,$10,$11,$12,$13) returning id`,
        [
          p.businessId, p.serviceId, slot.staffId, customerId, slot.start, slot.blockEnd, p.source,
          newBookingCode(), (p.notes ?? "").slice(0, 500), p.callId ?? null, p.idempotencyKey ?? null,
          Boolean(p.isSimulated), business.google_connected ? "pending" : "not_configured",
        ],
      );
      return r[0].id;
    });

  outer: for (const slot of candidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        createdId = await insertOnce(slot);
        break outer;
      } catch (err) {
        if (isExclusionViolation(err)) continue outer; // otra llamada se quedó ese hueco: probar con otro profesional
        const msg = String((err as Error).message);
        if (isUniqueViolation(err) && msg.includes("booking_code")) continue; // código repetido: reintentar
        if (isUniqueViolation(err) && p.idempotencyKey) return bookAppointment(deps, p); // mismo webhook a la vez
        throw err;
      }
    }
  }

  if (!createdId) {
    const alternatives = await searchAvailability(deps, { businessId: p.businessId, serviceId: p.serviceId, day, staffId: p.staffId, callId: p.callId });
    return { ok: false, code: "slot_taken", message: "Ese hueco se acaba de ocupar", alternatives };
  }

  const calendar = await syncAppointmentToCalendar(deps, business, createdId);
  const appointment = (await getAppointmentView(deps.db, p.businessId, createdId))!;
  await safeNotify(deps, { type: "booked", appointment, business, by: p.source === "manual" ? "staff" : "assistant" });
  return { ok: true, appointment, replayed: false, calendar };
}

function syncState(a: AppointmentView): "synced" | "failed" | "not_configured" {
  return a.gcal_sync_status === "synced" ? "synced" : a.gcal_sync_status === "not_configured" ? "not_configured" : "failed";
}

async function safeNotify(deps: BookingDeps, e: Parameters<NonNullable<BookingDeps["notify"]>>[0]) {
  if (!deps.notify) return;
  try {
    await deps.notify(e);
  } catch (err) {
    console.error("[notify] fallo al enviar el aviso de cita", (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Sincronización con calendario (la cita ya está guardada; un fallo aquí no la invalida)
// ---------------------------------------------------------------------------
export async function syncAppointmentToCalendar(
  deps: BookingDeps,
  business: Business,
  appointmentId: string,
): Promise<"synced" | "failed" | "not_configured"> {
  const a = await getAppointmentView(deps.db, business.id, appointmentId);
  if (!a) return "not_configured";
  const staffCal = (await deps.db.query<{ google_calendar_id: string | null }>(
    `select google_calendar_id from staff where id = $1`, [a.staff_id],
  ))[0]?.google_calendar_id;
  const calendarId = staffCal || business.google_calendar_id;
  if (!deps.calendar || !business.google_connected || !calendarId) {
    await deps.db.query(`update appointments set gcal_sync_status = 'not_configured' where id = $1`, [a.id]);
    return "not_configured";
  }
  try {
    if (a.status === "cancelled") {
      if (a.gcal_event_id) await deps.calendar.deleteEvent({ businessId: business.id, calendarId, eventId: a.gcal_event_id });
      await deps.db.query(`update appointments set gcal_sync_status = 'synced', gcal_error = null where id = $1`, [a.id]);
      return "synced";
    }
    const { eventId } = await deps.calendar.upsertEvent({
      businessId: business.id,
      calendarId,
      eventId: a.gcal_event_id,
      appointmentId: a.id,
      summary: `${a.service_name} · ${a.customer_name}`,
      // Datos mínimos en el calendario: sin teléfono ni notas.
      description: `Reservada por Volkra (${a.source === "ai_call" ? "asistente telefónico" : a.source === "simulator" ? "simulador" : "manual"}). Código ${a.booking_code}.`,
      start: new Date(a.starts_at),
      end: new Date(a.ends_at),
      timezone: business.timezone,
    });
    await deps.db.query(
      `update appointments set gcal_event_id = $2, gcal_sync_status = 'synced', gcal_error = null where id = $1`,
      [a.id, eventId],
    );
    return "synced";
  } catch (err) {
    const msg = (err as Error).message.slice(0, 300);
    await deps.db.query(`update appointments set gcal_sync_status = 'failed', gcal_error = $2 where id = $1`, [a.id, msg]);
    await createIssue(deps.db, {
      businessId: business.id,
      kind: "calendar_sync",
      message: `La cita ${a.booking_code} está guardada pero no se pudo sincronizar con Google Calendar: ${msg}. Se reintentará automáticamente.`,
      appointmentId: a.id,
      callId: a.call_id,
    });
    return "failed";
  }
}

/** Reintenta sincronizaciones pendientes o fallidas (cron). */
export async function retryPendingCalendarSyncs(deps: BookingDeps, limit = 50) {
  const rows = await deps.db.query<{ id: string; business_id: string }>(
    `select a.id, a.business_id from appointments a join businesses b on b.id = a.business_id
      where a.gcal_sync_status in ('pending', 'failed') and b.google_connected
      order by a.updated_at limit $1`,
    [limit],
  );
  let synced = 0;
  for (const r of rows) {
    const b = await getBusiness(deps.db, r.business_id);
    if (b && (await syncAppointmentToCalendar(deps, b, r.id)) === "synced") synced++;
  }
  return { attempted: rows.length, synced };
}

// ---------------------------------------------------------------------------
// Cambiar y cancelar
// ---------------------------------------------------------------------------
export type RescheduleResult =
  | { ok: true; appointment: AppointmentView; calendar: "synced" | "failed" | "not_configured" }
  | { ok: false; code: "not_found" | "not_active" | "slot_unavailable" | "slot_taken"; message: string; alternatives: SearchResult | null };

export async function rescheduleAppointment(
  deps: BookingDeps,
  p: { businessId: string; appointmentId: string; newStart: Date; staffId?: string | null; serviceId?: string; callId?: string | null; by?: ChangedBy },
): Promise<RescheduleResult> {
  const current = await getAppointmentView(deps.db, p.businessId, p.appointmentId);
  if (!current) return { ok: false, code: "not_found", message: "No encuentro esa cita", alternatives: null };
  if (current.status !== "confirmed") return { ok: false, code: "not_active", message: "Esa cita ya no está activa", alternatives: null };
  const business = (await getBusiness(deps.db, p.businessId))!;
  const serviceId = p.serviceId ?? current.service_id;
  const service = await loadService(deps.db, p.businessId, serviceId);
  if (!service) return { ok: false, code: "not_found", message: "Ese servicio no existe", alternatives: null };
  const staff = await staffForService(deps.db, p.businessId, serviceId);
  const day = localDay(p.newStart, business.timezone);
  const { slots } = await slotsForDay(deps, { business, service, staff }, day, {
    staffId: p.staffId === undefined ? null : p.staffId,
    excludeAppointmentId: current.id,
    callId: p.callId,
  });
  let matching = slots.filter((s) => s.start.getTime() === p.newStart.getTime());
  // Si no se pide profesional, preferir mantener el mismo
  if (!p.staffId) {
    matching = [...matching].sort((a, b) => Number(b.staffId === current.staff_id) - Number(a.staffId === current.staff_id));
  }
  if (matching.length === 0) {
    const alternatives = await searchAvailability(deps, {
      businessId: p.businessId, serviceId, day, staffId: p.staffId, excludeAppointmentId: current.id, callId: p.callId,
    });
    return { ok: false, code: "slot_unavailable", message: "Esa hora no está disponible", alternatives };
  }
  for (const slot of matching) {
    try {
      await deps.db.query(
        `update appointments set starts_at = $3, ends_at = $4, staff_id = $5, service_id = $6, updated_at = now(),
                gcal_sync_status = case when gcal_sync_status = 'not_configured' then 'not_configured' else 'pending' end
          where business_id = $1 and id = $2 and status = 'confirmed'`,
        [p.businessId, current.id, slot.start, slot.blockEnd, slot.staffId, serviceId],
      );
      const calendar = await syncAppointmentToCalendar(deps, business, current.id);
      const appointment = (await getAppointmentView(deps.db, p.businessId, current.id))!;
      await safeNotify(deps, { type: "rescheduled", appointment, business, by: p.by ?? "assistant", previousStart: new Date(current.starts_at) });
      return { ok: true, appointment, calendar };
    } catch (err) {
      if (isExclusionViolation(err)) continue;
      throw err;
    }
  }
  const alternatives = await searchAvailability(deps, { businessId: p.businessId, serviceId, day, excludeAppointmentId: current.id, callId: p.callId });
  return { ok: false, code: "slot_taken", message: "Ese hueco se acaba de ocupar", alternatives };
}

export async function cancelAppointment(
  deps: BookingDeps,
  p: { businessId: string; appointmentId: string; reason?: string; by?: ChangedBy },
): Promise<{ ok: true; appointment: AppointmentView; alreadyCancelled: boolean } | { ok: false; code: "not_found"; message: string }> {
  const current = await getAppointmentView(deps.db, p.businessId, p.appointmentId);
  if (!current) return { ok: false, code: "not_found", message: "No encuentro esa cita" };
  if (current.status === "cancelled") return { ok: true, appointment: current, alreadyCancelled: true };
  await deps.db.query(
    `update appointments set status = 'cancelled', cancelled_at = now(), cancel_reason = $3, updated_at = now(),
            gcal_sync_status = case when gcal_sync_status = 'not_configured' then 'not_configured' else 'pending' end
      where business_id = $1 and id = $2`,
    [p.businessId, p.appointmentId, (p.reason ?? "").slice(0, 300)],
  );
  const business = (await getBusiness(deps.db, p.businessId))!;
  await syncAppointmentToCalendar(deps, business, p.appointmentId);
  const appointment = (await getAppointmentView(deps.db, p.businessId, p.appointmentId))!;
  await safeNotify(deps, { type: "cancelled", appointment, business, by: p.by ?? "assistant" });
  return { ok: true, appointment, alreadyCancelled: false };
}
