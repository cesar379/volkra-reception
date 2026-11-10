"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireApp } from "@/server/auth";
import type { Queryable } from "@/server/db/client";
import { getDb } from "@/server/db";
import { newChatKey } from "@/server/webchat/session";
import { checkPhoneNumber, whatsappToken } from "@/server/whatsapp/handler";
import { encrypt } from "@/server/crypto";
import { env, features } from "@/server/env";
import { cookies } from "next/headers";
import { deleteBusiness, inviteEmail, inviteMember, removeMember, revokeInvite, type Role } from "@/server/team";
import { resendSend } from "@/server/notify";
import { createCheckout, createPortal, getBilling } from "@/server/billing";

type Tab = "negocio" | "horario" | "servicios" | "equipo" | "preguntas" | "agente" | "chat" | "whatsapp" | "integraciones" | "cuenta";

function done(tab: Tab, error?: string): never {
  revalidatePath("/", "layout");
  redirect(`/configuracion?tab=${tab}&${error ? `error=${encodeURIComponent(error)}` : "guardado=1"}`);
}

async function withBusiness<T>(fn: (q: Queryable, businessId: string) => Promise<T>) {
  const ctx = await requireApp();
  // Todas las escrituras se hacen como el usuario: RLS garantiza que solo toca su empresa.
  return ctx.asUser((q) => fn(q, ctx.business.id));
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const bool = (fd: FormData, k: string) => fd.get(k) === "on";
const E164 = /^\+[1-9]\d{7,14}$/;
function phoneOrNull(v: string) {
  const d = v.replace(/[\s().-]/g, "");
  if (!d) return null;
  const n = d.startsWith("00") ? `+${d.slice(2)}` : !d.startsWith("+") && d.length === 9 ? `+34${d}` : d;
  if (!E164.test(n)) throw new Error("Número de teléfono no válido. Usa formato internacional, por ejemplo +34 910 000 000.");
  return n;
}

/** "09:30-14:00, 16:00-20:30" → franjas. Vacío = cerrado. */
export async function parseRanges(text: string): Promise<{ opens: string; closes: string }[]> {
  const t = text.trim().toLowerCase();
  if (!t || t === "cerrado") return [];
  return t.split(/[,;y]+/).map((part) => {
    const m = part.trim().match(/^(\d{1,2})[:.]?(\d{2})?\s*(?:-|a|–)\s*(\d{1,2})[:.]?(\d{2})?$/);
    if (!m) throw new Error(`No entiendo la franja «${part.trim()}». Usa el formato 09:30-14:00.`);
    const opens = `${m[1].padStart(2, "0")}:${m[2] ?? "00"}`;
    const closes = `${m[3].padStart(2, "0")}:${m[4] ?? "00"}`;
    if (closes <= opens) throw new Error(`La franja ${opens}-${closes} termina antes de empezar.`);
    return { opens, closes };
  });
}

// ---------------------------------------------------------------------------
export async function saveBusiness(fd: FormData) {
  const data = z.object({
    name: z.string().min(2).max(120),
    vertical: z.enum(["clinica", "peluqueria", "taller", "academia", "otro"]),
    description: z.string().max(600),
    address: z.string().max(300),
    public_phone: z.string().max(40),
    notify_email: z.union([z.literal(""), z.string().email().max(200)]),
  }).safeParse({ name: str(fd, "name"), vertical: str(fd, "vertical"), description: str(fd, "description"), address: str(fd, "address"), public_phone: str(fd, "public_phone"), notify_email: str(fd, "notify_email").toLowerCase() });
  if (!data.success) done("negocio", "Revisa los campos: el nombre es obligatorio y el email de avisos debe ser válido.");
  await withBusiness((q, id) =>
    q.query(`update businesses set name=$2, vertical=$3, description=$4, address=$5, public_phone=$6, notify_email=$7, reminder_email=$8, updated_at=now() where id=$1`,
      [id, data.data.name, data.data.vertical, data.data.description, data.data.address, data.data.public_phone, data.data.notify_email || null, bool(fd, "reminder_email")]),
  );
  done("negocio");
}

export async function saveHours(fd: FormData) {
  try {
    const days: { weekday: number; ranges: { opens: string; closes: string }[] }[] = [];
    for (let d = 1; d <= 7; d++) days.push({ weekday: d, ranges: await parseRanges(str(fd, `d${d}`)) });
    const rules = z.object({ slot: z.coerce.number().int(), notice: z.coerce.number().int().min(0).max(10080), ahead: z.coerce.number().int().min(1).max(365) })
      .parse({ slot: str(fd, "slot_interval_min"), notice: str(fd, "min_notice_min"), ahead: str(fd, "max_days_ahead") });
    if (![5, 10, 15, 20, 30, 60].includes(rules.slot)) throw new Error("Intervalo no válido");
    await withBusiness(async (q, id) => {
      await q.query(`delete from business_hours where business_id = $1`, [id]);
      for (const d of days) for (const r of d.ranges) {
        await q.query(`insert into business_hours (business_id, weekday, opens, closes) values ($1,$2,$3,$4)`, [id, d.weekday, r.opens, r.closes]);
      }
      await q.query(`update businesses set slot_interval_min=$2, min_notice_min=$3, max_days_ahead=$4 where id=$1`, [id, rules.slot, rules.notice, rules.ahead]);
    });
  } catch (e) {
    done("horario", (e as Error).message);
  }
  done("horario");
}

export async function addSpecialDay(fd: FormData) {
  try {
    const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(str(fd, "day"));
    const closed = str(fd, "kind") !== "custom";
    const hours = closed ? [] : await parseRanges(str(fd, "hours"));
    if (!closed && hours.length === 0) throw new Error("Indica el horario especial o márcalo como cerrado.");
    await withBusiness((q, id) =>
      q.query(`insert into special_days (business_id, day, closed, hours, reason) values ($1,$2,$3,$4::jsonb,$5)
               on conflict (business_id, day) do update set closed = excluded.closed, hours = excluded.hours, reason = excluded.reason`,
        [id, day, closed, JSON.stringify(hours), str(fd, "reason").slice(0, 120)]),
    );
  } catch (e) {
    done("horario", (e as Error).message);
  }
  done("horario");
}

export async function deleteSpecialDay(fd: FormData) {
  await withBusiness((q, id) => q.query(`delete from special_days where business_id=$1 and id=$2`, [id, str(fd, "id")]));
  done("horario");
}

// ---------------------------------------------------------------------------
const serviceSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300),
  duration_min: z.coerce.number().int().min(5).max(480),
  buffer_min: z.coerce.number().int().min(0).max(120),
  price: z.string(),
});

export async function saveService(fd: FormData) {
  const parsed = serviceSchema.safeParse({ name: str(fd, "name"), description: str(fd, "description"), duration_min: str(fd, "duration_min"), buffer_min: str(fd, "buffer_min") || "0", price: str(fd, "price") });
  if (!parsed.success) done("servicios", "Revisa el nombre y la duración del servicio.");
  const p = parsed.data;
  const priceCents = p.price === "" ? null : Math.round(Number(p.price.replace(",", ".")) * 100);
  if (priceCents !== null && (!Number.isFinite(priceCents) || priceCents < 0)) done("servicios", "Precio no válido.");
  const staffIds = fd.getAll("staff").map(String);
  const id = str(fd, "id");
  await withBusiness(async (q, businessId) => {
    let serviceId = id;
    if (id) {
      await q.query(`update services set name=$3, description=$4, duration_min=$5, buffer_min=$6, price_cents=$7, price_from=$8, active=$9 where business_id=$1 and id=$2`,
        [businessId, id, p.name, p.description, p.duration_min, p.buffer_min, priceCents, bool(fd, "price_from"), bool(fd, "active")]);
    } else {
      const r = await q.query<{ id: string }>(`insert into services (business_id, name, description, duration_min, buffer_min, price_cents, price_from) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [businessId, p.name, p.description, p.duration_min, p.buffer_min, priceCents, bool(fd, "price_from")]);
      serviceId = r[0].id;
    }
    await q.query(`delete from staff_services where business_id=$1 and service_id=$2`, [businessId, serviceId]);
    for (const s of staffIds) await q.query(`insert into staff_services (business_id, staff_id, service_id) values ($1,$2,$3)`, [businessId, s, serviceId]);
  });
  done("servicios");
}

// ---------------------------------------------------------------------------
export async function saveStaff(fd: FormData) {
  const name = str(fd, "name");
  if (name.length < 2) done("equipo", "El nombre es obligatorio.");
  const id = str(fd, "id");
  try {
    const ownHours = bool(fd, "own_hours");
    const days: { weekday: number; ranges: { opens: string; closes: string }[] }[] = [];
    if (ownHours) for (let d = 1; d <= 7; d++) days.push({ weekday: d, ranges: await parseRanges(str(fd, `d${d}`)) });
    const color = /^#[0-9a-fA-F]{6}$/.test(str(fd, "color")) ? str(fd, "color") : "#4A5D5E";
    await withBusiness(async (q, businessId) => {
      let staffId = id;
      if (id) {
        await q.query(`update staff set name=$3, role_title=$4, color=$5, active=$6, google_calendar_id=$7 where business_id=$1 and id=$2`,
          [businessId, id, name, str(fd, "role_title"), color, bool(fd, "active"), str(fd, "google_calendar_id") || null]);
      } else {
        const r = await q.query<{ id: string }>(`insert into staff (business_id, name, role_title, color, google_calendar_id) values ($1,$2,$3,$4,$5) returning id`,
          [businessId, name, str(fd, "role_title"), color, str(fd, "google_calendar_id") || null]);
        staffId = r[0].id;
      }
      await q.query(`delete from staff_hours where business_id=$1 and staff_id=$2`, [businessId, staffId]);
      for (const d of days) for (const r of d.ranges) {
        await q.query(`insert into staff_hours (business_id, staff_id, weekday, opens, closes) values ($1,$2,$3,$4,$5)`, [businessId, staffId, d.weekday, r.opens, r.closes]);
      }
    });
  } catch (e) {
    done("equipo", (e as Error).message);
  }
  done("equipo");
}

export async function addTimeOff(fd: FormData) {
  try {
    const from = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(str(fd, "from"));
    const to = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(str(fd, "to"));
    if (to < from) throw new Error("La fecha final es anterior a la inicial.");
    await withBusiness(async (q, businessId) => {
      const tz = (await q.query<{ timezone: string }>(`select timezone from businesses where id=$1`, [businessId]))[0].timezone;
      await q.query(
        `insert into staff_time_off (business_id, staff_id, starts_at, ends_at, reason)
         values ($1, $2, ($3::date)::timestamp at time zone $5, (($4::date) + 1)::timestamp at time zone $5, $6)`,
        [businessId, str(fd, "staff_id"), from, to, tz, str(fd, "reason").slice(0, 120)],
      );
    });
  } catch (e) {
    done("equipo", (e as Error).message);
  }
  done("equipo");
}

export async function deleteTimeOff(fd: FormData) {
  await withBusiness((q, id) => q.query(`delete from staff_time_off where business_id=$1 and id=$2`, [id, str(fd, "id")]));
  done("equipo");
}

// ---------------------------------------------------------------------------
export async function saveFaq(fd: FormData) {
  const question = str(fd, "question");
  const answer = str(fd, "answer");
  if (question.length < 3 || answer.length < 2) done("preguntas", "Escribe la pregunta y la respuesta.");
  const id = str(fd, "id");
  await withBusiness((q, businessId) =>
    id
      ? q.query(`update faqs set question=$3, answer=$4 where business_id=$1 and id=$2`, [businessId, id, question.slice(0, 300), answer.slice(0, 1000)])
      : q.query(`insert into faqs (business_id, question, answer, position) values ($1,$2,$3,(select coalesce(max(position),0)+1 from faqs where business_id=$1))`, [businessId, question.slice(0, 300), answer.slice(0, 1000)]),
  );
  done("preguntas");
}

export async function deleteFaq(fd: FormData) {
  await withBusiness((q, id) => q.query(`delete from faqs where business_id=$1 and id=$2`, [id, str(fd, "id")]));
  done("preguntas");
}

// ---------------------------------------------------------------------------
export async function saveAgent(fd: FormData) {
  try {
    const model = str(fd, "voice_model");
    if (!["claude-sonnet-5", "claude-haiku-5-5"].includes(model)) throw new Error("Modelo no válido");
    const minutes = Number(str(fd, "minutes_saved_per_call").replace(",", "."));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60) throw new Error("Los minutos ahorrados por llamada deben estar entre 0 y 60.");
    const welcome = str(fd, "welcome_message").slice(0, 400);
    if (welcome && !/(asistente|virtual|inteligencia artificial|\bIA\b)/i.test(welcome)) {
      throw new Error("El saludo debe dejar claro que es un asistente virtual de IA (transparencia).");
    }
    const vapiId = str(fd, "vapi_phone_number_id") || null;
    const elevenId = str(fd, "elevenlabs_agent_id") || null;
    await withBusiness((q, id) =>
      q.query(
        `update businesses set agent_name=$2, welcome_message=$3, ai_instructions=$4, voice_model=$5, voice_id=$6,
                transfer_number=$7, agent_phone_number=$8, vapi_phone_number_id=$9, minutes_saved_per_call=$10,
                store_call_summaries=$11, recording_enabled=$12, elevenlabs_agent_id=$13, updated_at=now()
          where id=$1`,
        [id, str(fd, "agent_name").slice(0, 40) || "Lucía", welcome, str(fd, "ai_instructions").slice(0, 3000), model,
         str(fd, "voice_id") || "es-ES-ElviraNeural", phoneOrNull(str(fd, "transfer_number")), phoneOrNull(str(fd, "agent_phone_number")),
         vapiId, minutes, bool(fd, "store_call_summaries"), bool(fd, "recording_enabled"), elevenId],
      ),
    );
  } catch (e) {
    const msg = (e as { code?: string }).code === "23505" ? "Ese número o agente ya está asignado a otro negocio." : (e as Error).message;
    done("agente", msg);
  }
  done("agente");
}

export async function disconnectGoogle() {
  const ctx = await requireApp();
  await ctx.asUser((q) => q.query(`update businesses set google_connected=false where id=$1`, [ctx.business.id]));
  // El token cifrado no es accesible para el usuario (RLS): se borra desde el servidor.
  const db = await getDb();
  await db.query(`delete from google_credentials where business_id = $1`, [ctx.business.id]);
  done("integraciones");
}

export async function saveCalendarId(fd: FormData) {
  await withBusiness((q, id) => q.query(`update businesses set google_calendar_id=$2 where id=$1`, [id, str(fd, "google_calendar_id") || "primary"]));
  done("integraciones");
}

export async function enableWebChat() {
  await withBusiness((q, id) =>
    q.query(`update businesses set web_chat_enabled = true, web_chat_key = coalesce(web_chat_key, $2), updated_at = now() where id = $1`, [id, newChatKey()]),
  );
  done("chat");
}

export async function disableWebChat() {
  await withBusiness((q, id) => q.query(`update businesses set web_chat_enabled = false, updated_at = now() where id = $1`, [id]));
  done("chat");
}

/** Nueva clave: el código antiguo deja de funcionar en las webs donde estuviera pegado. */
export async function rotateWebChatKey() {
  await withBusiness((q, id) => q.query(`update businesses set web_chat_key = $2, updated_at = now() where id = $1`, [id, newChatKey()]));
  done("chat");
}

/**
 * WhatsApp: guarda el "Phone number ID" de Meta y, si se escribe, el token del negocio (cifrado).
 * Antes se comprueba con Meta que ese token da acceso a ese número.
 */
export async function saveWhatsApp(fd: FormData) {
  const ctx = await requireApp();
  const phoneNumberId = str(fd, "whatsapp_phone_number_id");
  const newToken = str(fd, "whatsapp_token");
  if (!/^\d{6,25}$/.test(phoneNumberId)) done("whatsapp", "El identificador del número (Phone number ID) son solo cifras.");
  const db = await getDb();
  const token = newToken || (await whatsappToken(db, ctx.business.id, env.WHATSAPP_ACCESS_TOKEN));
  if (!token) done("whatsapp", "Falta el token de acceso de Meta.");
  const check = await checkPhoneNumber({ baseUrl: env.WHATSAPP_GRAPH_URL, version: env.WHATSAPP_GRAPH_VERSION }, phoneNumberId, token);
  if (!check.ok) done("whatsapp", `Meta no reconoce ese número con este token: ${check.error}`);
  try {
    await ctx.asUser((q) =>
      q.query(`update businesses set whatsapp_phone_number_id = $2, whatsapp_display_phone = $3, whatsapp_enabled = true, updated_at = now() where id = $1`,
        [ctx.business.id, phoneNumberId, check.displayPhone]),
    );
  } catch (e) {
    done("whatsapp", (e as { code?: string }).code === "23505" ? "Ese número de WhatsApp ya está asignado a otro negocio." : (e as Error).message);
  }
  // El token no es accesible para el usuario (RLS): se guarda desde el servidor.
  if (newToken) {
    await db.query(
      `insert into whatsapp_credentials (business_id, access_token_enc) values ($1, $2)
       on conflict (business_id) do update set access_token_enc = excluded.access_token_enc, updated_at = now()`,
      [ctx.business.id, encrypt(newToken)],
    );
  }
  done("whatsapp");
}

export async function disableWhatsApp() {
  await withBusiness((q, id) => q.query(`update businesses set whatsapp_enabled = false, updated_at = now() where id = $1`, [id]));
  done("whatsapp");
}

/** Desconectar: libera el número y borra el token guardado. */
export async function disconnectWhatsApp() {
  const ctx = await requireApp();
  await ctx.asUser((q) =>
    q.query(`update businesses set whatsapp_enabled = false, whatsapp_phone_number_id = null, whatsapp_display_phone = null, updated_at = now() where id = $1`, [ctx.business.id]),
  );
  const db = await getDb();
  await db.query(`delete from whatsapp_credentials where business_id = $1`, [ctx.business.id]);
  done("whatsapp");
}

// ---------------------------------------------------------------------------
// Cuenta: personas con acceso, exportación y baja. Solo para administradores («owner»).
async function requireOwner() {
  const ctx = await requireApp();
  if (ctx.business.role !== "owner") done("cuenta", "Solo un administrador del negocio puede hacer esto.");
  return ctx;
}

export async function inviteUser(fd: FormData) {
  const ctx = await requireOwner();
  const email = str(fd, "email").toLowerCase();
  const role: Role = str(fd, "role") === "owner" ? "owner" : "staff";
  const db = await getDb();
  const r = await inviteMember(db, { businessId: ctx.business.id, email, role, invitedBy: ctx.session.userId });
  if (!r.ok) done("cuenta", r.error);
  if (features.email) {
    await resendSend(inviteEmail({ to: email, businessName: ctx.business.name, invitedBy: ctx.session.email, appUrl: env.APP_URL, role }))
      .catch((err) => console.error("[invitación] no se pudo enviar el email:", (err as Error).message));
  }
  done("cuenta");
}

export async function revokeUserInvite(fd: FormData) {
  const ctx = await requireOwner();
  await revokeInvite(await getDb(), ctx.business.id, str(fd, "id"));
  done("cuenta");
}

export async function removeUser(fd: FormData) {
  const ctx = await requireOwner();
  const r = await removeMember(await getDb(), ctx.business.id, str(fd, "user_id"));
  if (!r.ok) done("cuenta", r.error);
  done("cuenta");
}

export async function deleteMyBusiness(fd: FormData) {
  const ctx = await requireOwner();
  if (str(fd, "confirm") !== ctx.business.name) done("cuenta", "Escribe el nombre exacto del negocio para confirmar la baja.");
  await deleteBusiness(await getDb(), ctx.business.id);
  (await cookies()).delete("volkra_business");
  revalidatePath("/", "layout");
  redirect("/panel");
}

export async function startSubscription() {
  const ctx = await requireOwner();
  if (!features.billing) done("cuenta", "El cobro con Stripe no está configurado en el servidor.");
  const billing = await getBilling(await getDb(), ctx.business.id);
  let url: string;
  try {
    url = await createCheckout({
      secret: env.STRIPE_SECRET_KEY!, priceId: env.STRIPE_PRICE_ID!, businessId: ctx.business.id,
      customerId: billing.stripe_customer_id, email: ctx.session.email, appUrl: env.APP_URL,
    });
  } catch (err) {
    done("cuenta", `No se pudo abrir el pago: ${(err as Error).message}`);
  }
  redirect(url);
}

export async function openBillingPortal() {
  const ctx = await requireOwner();
  const billing = await getBilling(await getDb(), ctx.business.id);
  if (!features.billing || !billing.stripe_customer_id) done("cuenta", "Este negocio aún no tiene suscripción.");
  let url: string;
  try {
    url = await createPortal({ secret: env.STRIPE_SECRET_KEY!, customerId: billing.stripe_customer_id, appUrl: env.APP_URL });
  } catch (err) {
    done("cuenta", `No se pudo abrir la gestión de la suscripción: ${(err as Error).message}`);
  }
  redirect(url);
}
