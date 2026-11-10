import crypto from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { BookingDeps } from "../booking/service";
import type { Queryable } from "../db/client";
import { getBusiness, type Business } from "../booking/repo";
import { ensureCall } from "../agent/calls";
import { executeTool, type ToolOutput } from "../agent/tools";
import { buildSystemPrompt } from "../agent/prompt";
import { summarizeFromEvents } from "../vapi/handler";
import { CHAT_TOOLS, claudeTurn } from "../simulator/claude-engine";

/**
 * Chat web: el mismo agente que atiende el teléfono, por escrito, desde la web del negocio.
 * Es público (sin login), así que todo tiene límites: por conversación, por IP y por negocio.
 */
export const CHAT_LIMITS = {
  maxText: 600,
  maxTurns: 30,
  /** Reservas y recados por conversación y por IP al día (evita llenar la agenda o el email de spam). */
  maxActions: 2,
  actionsPerIpDay: 4,
  sessionsPerIpHour: 10,
  turnsPerBusinessDay: 1000,
  idleMinutes: 120,
};

export type ChatEngine = (input: {
  business: Business;
  system: { stable: string; volatile: string };
  messages: Anthropic.MessageParam[];
  userText: string;
  exec: (name: string, args: Record<string, unknown>) => Promise<ToolOutput>;
}) => Promise<{ messages: Anthropic.MessageParam[]; replies: string[] }>;

export const claudeChatEngine = (apiKey: string): ChatEngine => (i) =>
  claudeTurn({ apiKey, model: i.business.voice_model, system: i.system, messages: i.messages, userText: i.userText, exec: i.exec, tools: CHAT_TOOLS });

export type ChatErrorCode = "not_found" | "limit" | "busy" | "ended" | "empty";
export class ChatError extends Error {
  constructor(public code: ChatErrorCode, message: string) {
    super(message);
  }
}

export type ChatReply = { sessionId: string; replies: string[]; ended: boolean };

const ACTION_TOOLS = new Set(["reservar_cita", "dejar_recado"]);
const KEY = /^wc_[A-Za-z0-9_-]{16,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newChatKey(): string {
  return `wc_${crypto.randomBytes(18).toString("base64url")}`;
}

/** La IP nunca se guarda: solo un hash con el secreto de la app, para los límites. */
export function hashIp(ip: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);
}

export async function businessByChatKey(deps: BookingDeps, key: string): Promise<Business | null> {
  if (!KEY.test(key)) return null;
  const r = await deps.db.query<{ id: string }>(`select id from businesses where web_chat_key = $1 and web_chat_enabled`, [key]);
  return r[0] ? getBusiness(deps.db, r[0].id) : null;
}

export function chatGreeting(b: Pick<Business, "name" | "agent_name">): string {
  return `Hola, soy ${b.agent_name}, la asistente virtual de ${b.name}. ¿En qué puedo ayudarte?`;
}

type Session = { id: string; call_id: string; messages: Anthropic.MessageParam[]; turns: number; actions: number; ended: boolean; updated_at: Date; ip_hash: string };
const SESSION_COLS = "id, call_id, messages, turns, actions, ended, updated_at, ip_hash";

export async function sendChat(
  deps: BookingDeps,
  key: string,
  input: { sessionId?: string | null; text: string; ipHash: string },
  engine: ChatEngine,
): Promise<ChatReply> {
  const business = await businessByChatKey(deps, key);
  if (!business) throw new ChatError("not_found", "Chat no disponible.");
  return chatTurn(deps, business, { channel: "web", sessionId: input.sessionId, text: input.text, contactHash: input.ipHash, callerPhone: null }, engine);
}

/**
 * Un turno de conversación escrita (chat web o WhatsApp) con los límites comunes.
 *  - web: la conversación la identifica sessionId; contactHash es el hash de la IP; sin teléfono fiable.
 *  - whatsapp: la conversación es la última abierta de ese número; contactHash es el hash del número
 *    y callerPhone el número que da WhatsApp (fiable, como el de una llamada).
 */
export async function chatTurn(
  deps: BookingDeps,
  business: Business,
  input: { channel: "web" | "whatsapp"; sessionId?: string | null; text: string; contactHash: string; callerPhone: string | null },
  engine: ChatEngine,
): Promise<ChatReply> {
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, CHAT_LIMITS.maxText);
  if (!text) throw new ChatError("empty", "Mensaje vacío.");
  const db = deps.db;
  const now = deps.now();
  const whatsapp = input.channel === "whatsapp";

  const day = new Date(now.getTime() - 24 * 3600_000);
  const load = await db.query<{ n: number }>(`select coalesce(sum(turns), 0)::int n from chat_sessions where business_id = $1 and created_at > $2`, [business.id, day]);
  if (load[0].n >= CHAT_LIMITS.turnsPerBusinessDay) throw new ChatError("limit", "El chat está saturado. Inténtalo más tarde o llama al negocio.");

  // Conversación: nueva o existente (siempre del mismo negocio y canal)
  let session: Session | undefined;
  if (whatsapp) {
    session = (await db.query<Session>(
      `select ${SESSION_COLS} from chat_sessions where business_id = $1 and channel = 'whatsapp' and ip_hash = $2 and not ended order by updated_at desc limit 1`,
      [business.id, input.contactHash],
    ))[0];
  } else if (input.sessionId && UUID.test(input.sessionId)) {
    session = (await db.query<Session>(`select ${SESSION_COLS} from chat_sessions where id = $1 and business_id = $2 and channel = 'web'`, [input.sessionId, business.id]))[0];
  }

  const isOver = (s: Session) => s.ended || now.getTime() - new Date(s.updated_at).getTime() > CHAT_LIMITS.idleMinutes * 60_000 || s.turns >= CHAT_LIMITS.maxTurns;
  if (session && isOver(session)) {
    await db.query(`update chat_sessions set ended = true, messages = '[]'::jsonb where id = $1`, [session.id]);
    // En la web el visitante empieza otra; en WhatsApp la persona sigue escribiendo al mismo número.
    if (!whatsapp) throw new ChatError("ended", "Esta conversación ha terminado. Empieza otra.");
    session = undefined;
  }

  if (!session) {
    await purgeChatContent(db, now, business.id);
    const hour = new Date(now.getTime() - 3600_000);
    const recent = await db.query<{ n: number }>(`select count(*)::int n from chat_sessions where ip_hash = $1 and created_at > $2`, [input.contactHash, hour]);
    if (recent[0].n >= CHAT_LIMITS.sessionsPerIpHour) throw new ChatError("limit", "Demasiadas conversaciones seguidas. Inténtalo más tarde.");
    const callId = await ensureCall(db, {
      businessId: business.id,
      provider: input.channel,
      providerCallId: `${input.channel}-${crypto.randomUUID()}`,
      callerPhone: input.callerPhone,
      startedAt: now,
    });
    // En la web el saludo ya se ha mostrado; en WhatsApp escribe primero la persona.
    const greeting: Anthropic.MessageParam[] = whatsapp ? [] : [{ role: "user", content: "(El chat acaba de empezar.)" }, { role: "assistant", content: chatGreeting(business) }];
    session = (await db.query<Session>(
      `insert into chat_sessions (business_id, call_id, messages, ip_hash, channel, created_at, updated_at) values ($1, $2, $3::jsonb, $4, $5, $6, $6)
       returning ${SESSION_COLS}`,
      [business.id, callId, JSON.stringify(greeting), input.contactHash, input.channel, now],
    ))[0];
  }

  // Un solo turno a la vez por conversación
  const claimed = await db.query(
    `update chat_sessions set busy_until = $2 where id = $1 and (busy_until is null or busy_until < $3) returning id`,
    [session.id, new Date(now.getTime() + 90_000), now],
  );
  if (claimed.length === 0) throw new ChatError("busy", "Espera a la respuesta anterior.");

  let actions = session.actions;
  try {
    const ipActions = await db.query<{ n: number }>(`select coalesce(sum(actions), 0)::int n from chat_sessions where ip_hash = $1 and created_at > $2`, [session.ip_hash, day]);
    let ipCount = ipActions[0].n;
    const ctx = { deps, businessId: business.id, callId: session.call_id, callerPhone: input.callerPhone, simulated: false };
    const exec = async (name: string, args: Record<string, unknown>): Promise<ToolOutput> => {
      const counted = ACTION_TOOLS.has(name);
      if (counted && (actions >= CHAT_LIMITS.maxActions || ipCount >= CHAT_LIMITS.actionsPerIpDay)) {
        return {
          ok: false,
          error: "limite_alcanzado",
          instruccion: `No se pueden hacer más reservas ni recados en este chat. Para más gestiones, que llame al negocio${business.public_phone ? ` (${business.public_phone})` : ""}.`,
        };
      }
      const out = await executeTool({ ...ctx, toolCallId: `${input.channel}-${crypto.randomUUID()}` }, name, args);
      if (counted && out.ok) {
        actions++;
        ipCount++;
      }
      return out;
    };
    const system = await buildSystemPrompt(db, business, now, whatsapp ? "whatsapp" : "chat");
    const out = await engine({ business, system, messages: session.messages, userText: text, exec });
    await db.query(
      `update chat_sessions set messages = $2::jsonb, turns = turns + 1, actions = $3, busy_until = null, updated_at = $4 where id = $1`,
      [session.id, JSON.stringify(out.messages), actions, now],
    );
    await refreshCall(deps, business, session.call_id, whatsapp ? "whatsapp" : "chat web");
    return { sessionId: session.id, replies: out.replies, ended: false };
  } catch (err) {
    await db.query(`update chat_sessions set busy_until = null, actions = $2 where id = $1`, [session.id, actions]);
    throw err;
  }
}

/**
 * RGPD: el texto de una conversación solo hace falta mientras sigue abierta (es el contexto del agente).
 * Al terminar (inactividad o límite de turnos) se borra. Quedan el registro en Llamadas, con el resumen
 * breve si el negocio lo guarda, y los contadores de los límites (con el hash, nunca la IP ni el número).
 * Se llama al abrir una conversación nueva (solo ese negocio) y a diario desde /api/cron/daily.
 */
export async function purgeChatContent(q: Queryable, now: Date, businessId?: string): Promise<number> {
  const cutoff = new Date(now.getTime() - CHAT_LIMITS.idleMinutes * 60_000);
  const r = await q.query(
    `update chat_sessions set messages = '[]'::jsonb, ended = true
      where updated_at < $1 and (not ended or messages <> '[]'::jsonb) and (busy_until is null or busy_until < $2)
        and ($3::uuid is null or business_id = $3)
      returning id`,
    [cutoff, now, businessId ?? null],
  );
  return r.length;
}

/** El chat no "cuelga": tras cada turno se actualiza el registro con duración, resultado y resumen. */
async function refreshCall(deps: BookingDeps, business: Business, callId: string, reason: string) {
  const summary = business.store_call_summaries ? await summarizeFromEvents(deps, callId) : null;
  await deps.db.query(
    `update calls set ended_at = $2,
            duration_sec = greatest(0, extract(epoch from ($2::timestamptz - started_at))::int),
            ended_reason = $4,
            status = case when needs_review then 'failed' else 'completed' end,
            outcome = coalesce(outcome, 'no_action'),
            summary = $3
      where id = $1`,
    [callId, deps.now(), summary, reason],
  );
}
