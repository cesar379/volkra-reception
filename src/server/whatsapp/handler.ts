import crypto from "node:crypto";
import type { Queryable } from "../db/client";
import type { BookingDeps } from "../booking/service";
import { normalizePhone } from "../booking/service";
import { createIssue, getBusiness } from "../booking/repo";
import { decrypt, safeEqual } from "../crypto";
import { ChatError, chatTurn, hashIp, type ChatEngine } from "../webchat/session";

/**
 * WhatsApp Business (Cloud API de Meta): el mismo agente que el chat web, por WhatsApp.
 *
 *  - GET  /api/whatsapp/webhook → verificación de la suscripción (hub.verify_token)
 *  - POST /api/whatsapp/webhook → mensajes entrantes, firmados con X-Hub-Signature-256
 *
 * El negocio se identifica por el "Phone number ID" de Meta. El número de la persona lo da WhatsApp
 * (es fiable, como el de una llamada), así que puede ver y gestionar sus citas sin código.
 */

/** Cabecera "X-Hub-Signature-256: sha256=<hex>", HMAC-SHA256 del cuerpo con el secreto de la app de Meta. */
export function verifyMetaSignature(rawBody: string | Buffer, header: string | null, appSecret: string | undefined): boolean {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;
  return safeEqual(header, signMeta(rawBody, appSecret));
}

/** Meta firma los bytes tal cual llegan: se calcula sobre el cuerpo crudo, antes de interpretarlo. */
export function signMeta(rawBody: string | Buffer, appSecret: string) {
  return `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

/** Verificación de la suscripción: devuelve el challenge si el token coincide. */
export function verifySubscription(params: URLSearchParams, verifyToken: string | undefined): string | null {
  if (!verifyToken || params.get("hub.mode") !== "subscribe") return null;
  const token = params.get("hub.verify_token") ?? "";
  return safeEqual(token, verifyToken) ? params.get("hub.challenge") : null;
}

export type Inbound = { businessId: string; phoneNumberId: string; from: string; messageId: string; text: string | null };

type WaMessage = {
  id?: string;
  from?: string;
  /** Segundos Unix, en texto. */
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
};
type WaPayload = { entry?: { changes?: { field?: string; value?: { metadata?: { phone_number_id?: string }; messages?: WaMessage[] } }[] }[] };

function textOf(m: WaMessage): string | null {
  if (m.type === "text") return m.text?.body ?? null;
  if (m.type === "button") return m.button?.text ?? null;
  if (m.type === "interactive") return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
  return null; // audio, imagen, ubicación...: no se interpretan
}

/** Meta reintenta un webhook fallido durante días; los ids se guardan algo más para no contestar dos veces. */
export const WHATSAPP_RETENTION = { inboundIdsDays: 8, maxMessageAgeHours: 24 };

/**
 * Extrae los mensajes nuevos de un webhook. Ignora los estados (entregado, leído), los números que no
 * son de ningún negocio con WhatsApp activo, los mensajes ya recibidos (Meta reintenta los webhooks) y
 * los de hace más de 24 h (fuera de la ventana de WhatsApp ya no se puede contestar sin plantilla).
 */
export async function takeInbound(deps: BookingDeps, payload: unknown): Promise<Inbound[]> {
  const out: Inbound[] = [];
  for (const entry of (payload as WaPayload)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (change.field !== "messages" || !phoneNumberId || !value?.messages?.length) continue;
      const biz = await deps.db.query<{ id: string }>(`select id from businesses where whatsapp_phone_number_id = $1 and whatsapp_enabled`, [phoneNumberId]);
      if (!biz[0]) continue;
      for (const m of value.messages) {
        if (!m.id || !m.from) continue;
        const sentAt = Number(m.timestamp) * 1000;
        if (sentAt && deps.now().getTime() - sentAt > WHATSAPP_RETENTION.maxMessageAgeHours * 3600_000) continue;
        const fresh = await deps.db.query(
          `insert into whatsapp_inbound (wa_message_id, business_id, received_at) values ($1, $2, $3) on conflict do nothing returning wa_message_id`,
          [m.id, biz[0].id, deps.now()],
        );
        if (fresh.length === 0) continue;
        out.push({ businessId: biz[0].id, phoneNumberId, from: m.from, messageId: m.id, text: textOf(m) });
      }
    }
  }
  return out;
}

/** Ids de mensajes ya atendidos: solo hacen falta mientras Meta pueda reintentar el webhook. */
export async function purgeWhatsAppInbound(q: Queryable, now: Date): Promise<number> {
  const r = await q.query(`delete from whatsapp_inbound where received_at < $1 returning wa_message_id`, [
    new Date(now.getTime() - WHATSAPP_RETENTION.inboundIdsDays * 24 * 3600_000),
  ]);
  return r.length;
}

export type WhatsAppSender = {
  send: (m: { phoneNumberId: string; token: string; to: string; text: string }) => Promise<void>;
  /** Marca el mensaje como leído y muestra "escribiendo…". Opcional: si falla no pasa nada. */
  markRead?: (m: { phoneNumberId: string; token: string; messageId: string }) => Promise<void>;
};

export async function whatsappToken(q: Queryable, businessId: string, fallback: string | undefined): Promise<string | null> {
  const r = await q.query<{ access_token_enc: string }>(`select access_token_enc from whatsapp_credentials where business_id = $1`, [businessId]);
  return r[0] ? decrypt(r[0].access_token_enc) : (fallback ?? null);
}

export const WHATSAPP_TEXT = {
  notText: "Por ahora solo puedo leer mensajes escritos. ¿Me lo escribes, por favor?",
  failed: "Perdona, ahora mismo no puedo responder. Inténtalo en unos minutos o llama al negocio.",
};

/** Atiende un mensaje entrante: turno del agente y respuesta por WhatsApp. Nunca lanza. */
export async function handleInbound(
  deps: BookingDeps,
  msg: Inbound,
  opts: { engine: ChatEngine; sender: WhatsAppSender; secret: string; fallbackToken?: string; sleep?: (ms: number) => Promise<void> },
): Promise<void> {
  const business = await getBusiness(deps.db, msg.businessId);
  const token = business ? await whatsappToken(deps.db, business.id, opts.fallbackToken) : null;
  if (!business || !token) return;
  const reply = (text: string) => opts.sender.send({ phoneNumberId: msg.phoneNumberId, token, to: msg.from, text });
  await opts.sender.markRead?.({ phoneNumberId: msg.phoneNumberId, token, messageId: msg.messageId }).catch(() => undefined);

  const phone = normalizePhone(msg.from);
  try {
    if (!msg.text?.trim() || !phone) {
      await reply(WHATSAPP_TEXT.notText);
      return;
    }
    const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    // Es normal escribir varios mensajes seguidos: si hay un turno en curso, se espera a que acabe.
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await chatTurn(
          deps,
          business,
          { channel: "whatsapp", text: msg.text, contactHash: hashIp(`wa:${phone}`, opts.secret), callerPhone: phone },
          opts.engine,
        );
        for (const text of r.replies) await reply(text);
        return;
      } catch (err) {
        if (err instanceof ChatError && err.code === "busy" && attempt < 30) {
          await sleep(1500);
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    if (err instanceof ChatError) {
      if (err.code !== "empty") await reply(err.message).catch(() => undefined);
      return;
    }
    console.error("[whatsapp]", err);
    await reply(WHATSAPP_TEXT.failed).catch(() => undefined);
    await createIssue(deps.db, {
      businessId: business.id,
      kind: "tool_error",
      message: `WhatsApp: no se pudo responder a un mensaje (…${phone?.slice(-4) ?? "????"}). ${err instanceof Error ? err.message : ""}`,
    }).catch(() => undefined);
  }
}

/**
 * Comprueba que el token da acceso a ese número (así nadie puede asignarse el número de otro negocio)
 * y devuelve el número visible.
 */
export type GraphApi = { baseUrl: string; version: string };

export async function checkPhoneNumber(graph: GraphApi, phoneNumberId: string, token: string): Promise<{ ok: true; displayPhone: string } | { ok: false; error: string }> {
  try {
    const r = await fetch(`${graph.baseUrl}/${graph.version}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await r.json().catch(() => ({}))) as { display_phone_number?: string; error?: { message?: string } };
    if (!r.ok || !body.display_phone_number) return { ok: false, error: body.error?.message ?? `Meta respondió ${r.status}` };
    return { ok: true, displayPhone: body.display_phone_number };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "sin conexión con Meta" };
  }
}

/** Envío real con la Graph API de Meta. */
export function graphSender(graph: GraphApi): WhatsAppSender {
  const post = async (phoneNumberId: string, token: string, body: Record<string, unknown>) => {
    const r = await fetch(`${graph.baseUrl}/${graph.version}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${(await r.text()).slice(0, 300)}`);
  };
  return {
    send: ({ phoneNumberId, token, to, text }) =>
      post(phoneNumberId, token, { recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text.slice(0, 4096) } }),
    markRead: ({ phoneNumberId, token, messageId }) =>
      post(phoneNumberId, token, { status: "read", message_id: messageId, typing_indicator: { type: "text" } }),
  };
}
