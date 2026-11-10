import type { BookingDeps, SearchResult } from "../booking/service";
import {
  bookAppointment,
  cancelAppointment,
  normalizePhone,
  rescheduleAppointment,
  searchAvailability,
} from "../booking/service";
import { createIssue, getBusiness, getBusinessHours, getFaqs, listServices, listStaff, type Business, type Service, type Staff } from "../booking/repo";
import { normalize, parseDay, parsePartOfDay } from "../booking/spanish-dates";
import { localDay, parseLocalDateTime, spokenDay, spokenTime, toLocal } from "../booking/time";
import { logEvent, setOutcome } from "./calls";
import { safeAlert } from "./alerts";
import type { ToolName } from "./tool-definitions";
import { describeHours, formatPrice } from "./prompt";

export type ToolContext = {
  deps: BookingDeps;
  businessId: string;
  callId: string; // id interno de la llamada
  /** Número desde el que llama la persona, dado por la telefonía (fiable). Nunca lo aporta el modelo. */
  callerPhone: string | null;
  simulated: boolean;
  /** Clave de idempotencia de la llamada a herramienta (id del tool call). */
  toolCallId?: string;
};

export type ToolOutput = Record<string, unknown> & { ok: boolean };

// ---------------------------------------------------------------------------
// Ayudas de resolución
// ---------------------------------------------------------------------------
function score(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 80;
  const wa = new Set(na.split(" ").filter((w) => w.length > 2));
  const wb = nb.split(" ").filter((w) => w.length > 2);
  const common = wb.filter((w) => wa.has(w) || [...wa].some((x) => x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5))));
  return common.length * 30;
}

export function resolveService(services: Service[], text: string): { service?: Service; candidates: Service[] } {
  const byId = services.find((s) => s.id === text);
  if (byId) return { service: byId, candidates: [byId] };
  const ranked = services.map((s) => ({ s, sc: score(s.name, text) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc);
  if (ranked.length === 0) return { candidates: [] };
  if (ranked.length === 1 || ranked[0].sc > ranked[1].sc) return { service: ranked[0].s, candidates: [ranked[0].s] };
  return { candidates: ranked.filter((x) => x.sc === ranked[0].sc).map((x) => x.s) };
}

const ANY_STAFF = /^(cualquiera|cualquier|me da igual|da igual|indiferente|sin preferencia|)$/;
export function resolveStaff(staff: Staff[], text: string | undefined | null): { staffId: string | null; unknown?: boolean } {
  if (!text || ANY_STAFF.test(normalize(text))) return { staffId: null };
  const byId = staff.find((s) => s.id === text);
  if (byId) return { staffId: byId.id };
  const ranked = staff.map((s) => ({ s, sc: score(s.name, text) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc);
  return ranked[0] ? { staffId: ranked[0].s.id } : { staffId: null, unknown: true };
}

function offersForVoice(business: Business, offers: Extract<SearchResult, { status: "ok" }>["offers"]) {
  const tz = business.timezone;
  return offers.map((o) => ({
    inicio: toLocal(o.start, tz).toFormat("yyyy-LL-dd'T'HH:mm"),
    decir: `${spokenDay(o.start, tz)} ${spokenTime(o.start, tz)}`,
    profesional_id: o.staff.length === 1 ? o.staff[0].id : "cualquiera",
    profesionales: o.staff.map((s) => s.name),
  }));
}

function namesMatch(said: string | undefined, stored: string): boolean {
  if (!said) return false;
  const a = normalize(said).split(" ")[0];
  const b = normalize(stored).split(" ")[0];
  return a.length >= 2 && a === b;
}

type ApptLite = { id: string; booking_code: string; starts_at: Date; status: string; service_name: string; staff_name: string; customer_name: string; customer_phone: string | null };

async function findByCode(ctx: ToolContext, code: string): Promise<ApptLite | null> {
  const r = await ctx.deps.db.query<ApptLite>(
    `select a.id, a.booking_code, a.starts_at, a.status, sv.name as service_name, st.name as staff_name, c.name as customer_name, c.phone as customer_phone
       from appointments a join services sv on sv.id = a.service_id join staff st on st.id = a.staff_id join customers c on c.id = a.customer_id
      where a.business_id = $1 and upper(a.booking_code) = upper($2)`,
    [ctx.businessId, code.replace(/[^A-Za-z0-9]/g, "")],
  );
  return r[0] ?? null;
}

/**
 * Verificación de identidad para ver, cambiar o cancelar una cita:
 *  - llama desde el teléfono con el que se reservó (dato de la telefonía, no del modelo), o
 *  - da el código de la cita y el nombre con el que se reservó.
 */
function verified(ctx: ToolContext, appt: ApptLite, nombre?: string): boolean {
  const caller = normalizePhone(ctx.callerPhone);
  if (caller && appt.customer_phone && caller === appt.customer_phone) return true;
  return namesMatch(nombre, appt.customer_name);
}

const DENIED = {
  ok: false,
  error: "verificacion_necesaria",
  instruccion: "Por seguridad, pide el código de la cita y el nombre con el que se reservó. No des detalles de la cita hasta verificarlo.",
};

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------
export async function executeTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolOutput> {
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : undefined);
  await logEvent(ctx.deps.db, { businessId: ctx.businessId, callId: ctx.callId, kind: "tool_call", name, detail: args });
  try {
    const out = await run(ctx, name as ToolName, s, args);
    await logEvent(ctx.deps.db, {
      businessId: ctx.businessId,
      callId: ctx.callId,
      kind: "tool_result",
      name,
      detail: { ok: out.ok, error: out.error ?? null, resumen: out.resumen ?? null },
    });
    return out;
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[tool ${name}]`, err);
    await logEvent(ctx.deps.db, { businessId: ctx.businessId, callId: ctx.callId, kind: "error", name, detail: { message: message.slice(0, 300) } });
    await ctx.deps.db.query(`update calls set needs_review = true where id = $1`, [ctx.callId]);
    await setOutcome(ctx.deps.db, ctx.callId, "error");
    await createIssue(ctx.deps.db, {
      businessId: ctx.businessId,
      kind: "tool_error",
      message: `Error técnico en "${name}" durante una llamada: ${message.slice(0, 300)}`,
      callId: ctx.callId,
    });
    return {
      ok: false,
      error: "error_tecnico",
      instruccion: "Ha fallado el sistema. Discúlpate con naturalidad, NO confirmes nada y ofrece dejar un recado o pasar con una persona.",
    };
  }
}

async function run(ctx: ToolContext, name: ToolName, s: (k: string) => string | undefined, args: Record<string, unknown>): Promise<ToolOutput> {
  const db = ctx.deps.db;
  const business = await getBusiness(db, ctx.businessId);
  if (!business) throw new Error("negocio no encontrado");
  const tz = business.timezone;

  switch (name) {
    case "buscar_huecos": {
      const services = await listServices(db, business.id);
      const { service, candidates } = resolveService(services, s("servicio") ?? "");
      if (!service) {
        return {
          ok: false,
          error: candidates.length ? "servicio_ambiguo" : "servicio_desconocido",
          opciones: (candidates.length ? candidates : services).map((x) => x.name),
          instruccion: "Pregunta a la persona cuál de estos servicios necesita.",
        };
      }
      const parsed = parseDay(s("dia") ?? "", ctx.deps.now(), tz);
      if (!parsed.ok) return { ok: false, error: "dia_no_entendido", instruccion: "Pide que te diga el día de otra forma (por ejemplo, el jueves o el 15 de noviembre)." };
      const staff = await listStaff(db, business.id);
      const pref = resolveStaff(staff, s("profesional"));
      const result = await searchAvailability(ctx.deps, {
        businessId: business.id,
        serviceId: service.id,
        day: parsed.day,
        flexibleDays: parsed.flexibleDays,
        part: parsePartOfDay(s("franja")),
        staffId: pref.staffId,
        callId: ctx.callId,
      });
      const base = { servicio: service.name, duracion_min: service.duration_min, precio: formatPrice(service) };
      if (result.status === "ok") {
        return {
          ok: true,
          ...base,
          dia: spokenDay(new Date(`${result.day}T12:00:00Z`), tz),
          opciones: offersForVoice(business, result.offers),
          aviso: pref.unknown ? "No conozco a ese profesional; muestro la disponibilidad de todo el equipo." : undefined,
          instruccion: "Ofrece como mucho dos o tres de estas horas, de forma natural. No ofrezcas ninguna otra hora.",
          resumen: `${result.offers.length} opciones para ${service.name}`,
        };
      }
      if (result.status === "error") return { ok: false, error: result.code, instruccion: result.message };
      const alternatives = offersForVoice(business, result.nextOffers);
      return {
        ok: false,
        ...base,
        error: result.status === "closed" ? "cerrado" : "sin_huecos",
        motivo: result.status === "closed" ? result.reason : "agenda completa ese día",
        alternativas: alternatives,
        instruccion: alternatives.length
          ? "Explica brevemente que ese día no es posible y ofrece estas alternativas."
          : "Explica que no hay huecos próximos y ofrece dejar un recado.",
        resumen: `sin huecos (${result.status})`,
      };
    }

    case "reservar_cita": {
      const services = await listServices(db, business.id);
      const { service } = resolveService(services, s("servicio") ?? "");
      if (!service) return { ok: false, error: "servicio_desconocido", opciones: services.map((x) => x.name) };
      const start = parseLocalDateTime(s("inicio") ?? "", tz);
      if (!start) return { ok: false, error: "hora_no_valida", instruccion: "Vuelve a buscar huecos y usa el valor 'inicio' de una opción." };
      const nombre = s("nombre");
      if (!nombre || nombre.length < 2) return { ok: false, error: "falta_nombre", instruccion: "Pregunta el nombre y apellido." };
      const phone = normalizePhone(s("telefono")) ?? normalizePhone(ctx.callerPhone);
      if (!phone) return { ok: false, error: "falta_telefono", instruccion: "Pide un teléfono de contacto para la cita." };
      const staff = await listStaff(db, business.id);
      const pref = resolveStaff(staff, s("profesional"));
      const r = await bookAppointment(ctx.deps, {
        businessId: business.id,
        serviceId: service.id,
        start,
        staffId: pref.staffId,
        customer: { name: nombre, phone, email: s("email") ?? null, emailConsent: args.acepta_email === true },
        source: ctx.simulated ? "simulator" : "ai_call",
        callId: ctx.callId,
        idempotencyKey: ctx.toolCallId ? `tool:${ctx.toolCallId}` : null,
        isSimulated: ctx.simulated,
      });
      if (!r.ok) {
        const alts = r.alternatives?.status === "ok" ? offersForVoice(business, r.alternatives.offers)
          : r.alternatives && "nextOffers" in r.alternatives ? offersForVoice(business, r.alternatives.nextOffers) : [];
        return {
          ok: false,
          error: r.code === "slot_taken" ? "hueco_ocupado" : "hueco_no_disponible",
          alternativas: alts,
          instruccion: "No confirmes nada. Explica que esa hora ya no está libre y ofrece estas alternativas.",
          resumen: r.code,
        };
      }
      await setOutcome(db, ctx.callId, "booked");
      const a = r.appointment;
      return {
        ok: true,
        confirmada: true,
        codigo: a.booking_code,
        servicio: a.service_name,
        profesional: a.staff_name,
        cuando: `${spokenDay(new Date(a.starts_at), tz)} ${spokenTime(new Date(a.starts_at), tz)}`,
        instruccion: "Confirma la cita con día y hora en una frase. Ofrece decir el código de la cita por si necesita cambiarla.",
        resumen: `reservada ${a.booking_code}`,
      };
    }

    case "buscar_mis_citas": {
      const caller = normalizePhone(ctx.callerPhone);
      const codigo = s("codigo");
      let rows: ApptLite[] = [];
      if (codigo) {
        const a = await findByCode(ctx, codigo);
        if (!a || !verified(ctx, a, s("nombre"))) return DENIED;
        rows = [a];
      } else if (caller) {
        rows = await db.query<ApptLite>(
          `select a.id, a.booking_code, a.starts_at, a.status, sv.name as service_name, st.name as staff_name, c.name as customer_name, c.phone as customer_phone
             from appointments a join services sv on sv.id = a.service_id join staff st on st.id = a.staff_id join customers c on c.id = a.customer_id
            where a.business_id = $1 and c.phone = $2 and a.status = 'confirmed' and a.starts_at > $3
            order by a.starts_at limit 5`,
          [business.id, caller, ctx.deps.now()],
        );
      } else {
        return DENIED;
      }
      const upcoming = rows.filter((r) => r.status === "confirmed" && new Date(r.starts_at) > ctx.deps.now());
      if (upcoming.length === 0) {
        return { ok: true, citas: [], instruccion: "No hay citas próximas a su nombre. Pregunta si llamó desde otro número o si tiene el código de la cita." };
      }
      return {
        ok: true,
        citas: upcoming.map((r) => ({
          codigo: r.booking_code,
          servicio: r.service_name,
          profesional: r.staff_name,
          cuando: `${spokenDay(new Date(r.starts_at), tz)} ${spokenTime(new Date(r.starts_at), tz)}`,
        })),
        resumen: `${upcoming.length} citas encontradas`,
      };
    }

    case "cambiar_cita":
    case "cancelar_cita": {
      const a = await findByCode(ctx, s("cita") ?? "");
      if (!a || !verified(ctx, a, s("nombre"))) return DENIED;
      if (a.status !== "confirmed") return { ok: false, error: "cita_no_activa", instruccion: "Esa cita ya estaba cancelada o ya pasó." };
      if (name === "cancelar_cita") {
        const r = await cancelAppointment(ctx.deps, { businessId: business.id, appointmentId: a.id, reason: s("motivo") });
        if (!r.ok) return { ok: false, error: r.code };
        await setOutcome(db, ctx.callId, "cancelled");
        return { ok: true, cancelada: true, instruccion: "Confirma que la cita queda cancelada y pregunta si quiere pedir otra.", resumen: `cancelada ${a.booking_code}` };
      }
      const newStart = parseLocalDateTime(s("nuevo_inicio") ?? "", tz);
      if (!newStart) return { ok: false, error: "hora_no_valida", instruccion: "Busca huecos y usa el valor 'inicio' de una opción." };
      const staff = await listStaff(db, business.id);
      const pref = resolveStaff(staff, s("profesional"));
      const r = await rescheduleAppointment(ctx.deps, { businessId: business.id, appointmentId: a.id, newStart, staffId: pref.staffId, callId: ctx.callId });
      if (!r.ok) {
        const alts = r.alternatives?.status === "ok" ? offersForVoice(business, r.alternatives.offers) : [];
        return { ok: false, error: r.code, alternativas: alts, instruccion: "No confirmes el cambio. Ofrece estas alternativas." };
      }
      await setOutcome(db, ctx.callId, "rescheduled");
      return {
        ok: true,
        cambiada: true,
        codigo: r.appointment.booking_code,
        cuando: `${spokenDay(new Date(r.appointment.starts_at), tz)} ${spokenTime(new Date(r.appointment.starts_at), tz)}`,
        profesional: r.appointment.staff_name,
        resumen: `cambiada ${a.booking_code}`,
      };
    }

    case "consultar_informacion": {
      const pregunta = s("pregunta") ?? "";
      const answer = await lookupInfo(ctx, business, pregunta);
      if (answer) {
        await setOutcome(db, ctx.callId, "info");
        return { ok: true, encontrado: true, respuesta: answer, resumen: "información encontrada" };
      }
      await createIssue(db, {
        businessId: business.id,
        kind: "unknown_question",
        message: `Pregunta sin respuesta en la configuración: "${pregunta.slice(0, 200)}". Conviene añadirla a las preguntas frecuentes.`,
        callId: ctx.callId,
      });
      return {
        ok: true,
        encontrado: false,
        instruccion: "No tienes ese dato. Dilo con naturalidad, no inventes, y ofrece dejar un recado o pasar con una persona.",
        resumen: "pregunta desconocida",
      };
    }

    case "dejar_recado": {
      const phone = normalizePhone(s("telefono")) ?? normalizePhone(ctx.callerPhone);
      const nombre = s("nombre") ?? "Sin nombre";
      const rawEmail = s("email")?.trim().toLowerCase();
      const email = rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail.slice(0, 200) : null;
      const contact = [phone, email].filter(Boolean).join(", ");
      await createIssue(db, {
        businessId: business.id,
        kind: "callback_request",
        message: `Contactar con ${nombre}${contact ? ` (${contact})` : ""}: ${(s("motivo") ?? "").slice(0, 300)}`,
        callId: ctx.callId,
      });
      await setOutcome(db, ctx.callId, "message");
      // Las conversaciones del simulador no avisan por email (son pruebas).
      if (!ctx.simulated) {
        await safeAlert(ctx.deps, { business, kind: "callback_request", name: nombre, phone, email, reason: (s("motivo") ?? "").slice(0, 300), at: ctx.deps.now() });
      }
      return { ok: true, recado_guardado: true, instruccion: email && !phone ? "Confirma que el equipo le escribirá lo antes posible, en horario de apertura." : "Confirma que el equipo le devolverá la llamada lo antes posible, en horario de apertura.", resumen: "recado guardado" };
    }

    default:
      return { ok: false, error: "herramienta_desconocida" };
  }
}

/** Busca la respuesta en los datos configurados del negocio. Si no está, devuelve null (no se inventa). */
export async function lookupInfo(ctx: ToolContext, business: Business, question: string): Promise<string | null> {
  const q = normalize(question);
  const db = ctx.deps.db;
  if (/\b(horario|abr[ie]s|abren|cierr|hora de apertura|que horas)\b/.test(q)) {
    return describeHours(await getBusinessHours(db, business.id));
  }
  if (/\b(donde|direccion|como llego|ubicad|calle)\b/.test(q) && business.address) return business.address;
  if (/\b(precio|cuesta|cuanto|tarifa|vale)\b/.test(q)) {
    const services = await listServices(db, business.id);
    const { service } = resolveService(services, question);
    if (service) return `${service.name}: ${formatPrice(service)}, unos ${service.duration_min} minutos.`;
  }
  const faqs = await getFaqs(db, business.id);
  const words = q.split(" ").filter((w) => w.length > 3);
  let best: { a: string; n: number } | null = null;
  for (const f of faqs) {
    const fq = normalize(`${f.question} ${f.answer}`);
    const n = words.filter((w) => fq.includes(w.slice(0, Math.max(4, w.length - 2)))).length;
    if (n > 0 && (!best || n > best.n)) best = { a: f.answer, n };
  }
  return best && best.n >= 1 && words.length > 0 && best.n / words.length >= 0.34 ? best.a : null;
}

export function todayContext(now: Date, tz: string) {
  const d = toLocal(now, tz).setLocale("es");
  return { iso: localDay(now, tz), text: d.toFormat("cccc d 'de' LLLL 'de' yyyy, HH:mm") };
}
