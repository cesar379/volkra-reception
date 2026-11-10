"use server";

import { revalidatePath } from "next/cache";
import { requireApp } from "@/server/auth";
import { bookingDeps } from "@/server/deps";
import { bookAppointment, cancelAppointment, rescheduleAppointment, searchAvailability } from "@/server/booking/service";
import { getBusiness } from "@/server/booking/repo";
import { toLocal } from "@/server/booking/time";

export type SlotOption = { start: string; label: string; staff: { id: string; name: string }[] };
export type SlotsResult = { ok: true; day: string; options: SlotOption[]; note?: string } | { ok: false; message: string };

/** Huecos libres reales de un día (mismo motor que usa el asistente). */
export async function getSlots(input: { serviceId: string; day: string; staffId: string | null; excludeAppointmentId?: string }): Promise<SlotsResult> {
  const ctx = await requireApp();
  const deps = await bookingDeps();
  const business = (await getBusiness(deps.db, ctx.business.id))!;
  const r = await searchAvailability(deps, {
    businessId: ctx.business.id,
    serviceId: input.serviceId,
    day: input.day,
    staffId: input.staffId,
    excludeAppointmentId: input.excludeAppointmentId,
    maxOffers: 200,
  });
  const fmt = (o: { start: Date; staff: { id: string; name: string }[] }) => ({
    start: o.start.toISOString(),
    label: toLocal(o.start, business.timezone).toFormat("HH:mm"),
    staff: o.staff,
  });
  if (r.status === "ok") {
    if (r.day !== input.day) return { ok: true, day: r.day, options: r.offers.map(fmt), note: "Ese día no hay huecos: se muestran los del siguiente día disponible." };
    return { ok: true, day: r.day, options: r.offers.map(fmt) };
  }
  if (r.status === "error") return { ok: false, message: r.message };
  const reason = r.status === "closed" ? `Cerrado: ${r.reason}.` : "No quedan huecos ese día.";
  const next = r.nextOffers[0];
  return { ok: false, message: next ? `${reason} Próximo hueco: ${toLocal(next.start, business.timezone).setLocale("es").toFormat("cccc d 'de' LLLL 'a las' HH:mm")}.` : reason };
}

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

export async function createAppointment(input: {
  serviceId: string; start: string; staffId: string | null; name: string; phone: string; email?: string; emailConsent?: boolean; notes?: string;
}): Promise<ActionResult> {
  const ctx = await requireApp();
  const r = await bookAppointment(await bookingDeps(), {
    businessId: ctx.business.id,
    serviceId: input.serviceId,
    start: new Date(input.start),
    staffId: input.staffId,
    customer: { name: input.name, phone: input.phone, email: input.email || null, emailConsent: Boolean(input.emailConsent) },
    source: "manual",
    notes: input.notes,
  });
  revalidatePath("/agenda");
  if (!r.ok) return { ok: false, message: r.code === "slot_taken" ? "Ese hueco se acaba de ocupar. Elige otro." : r.message };
  const cal = r.calendar === "failed" ? " (no se pudo sincronizar con Google Calendar; se reintentará)" : "";
  return { ok: true, message: `Cita creada · código ${r.appointment.booking_code}${cal}` };
}

export async function moveAppointment(input: { appointmentId: string; start: string; staffId: string | null }): Promise<ActionResult> {
  const ctx = await requireApp();
  const r = await rescheduleAppointment(await bookingDeps(), {
    businessId: ctx.business.id, appointmentId: input.appointmentId, newStart: new Date(input.start), staffId: input.staffId, by: "staff",
  });
  revalidatePath("/agenda");
  return r.ok ? { ok: true, message: "Cita cambiada" } : { ok: false, message: r.message };
}

export async function cancelAppointmentAction(input: { appointmentId: string; reason?: string }): Promise<ActionResult> {
  const ctx = await requireApp();
  const r = await cancelAppointment(await bookingDeps(), { businessId: ctx.business.id, appointmentId: input.appointmentId, reason: input.reason, by: "staff" });
  revalidatePath("/agenda");
  return r.ok ? { ok: true, message: r.alreadyCancelled ? "La cita ya estaba cancelada" : "Cita cancelada" } : { ok: false, message: r.message };
}
