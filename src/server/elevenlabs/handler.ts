import crypto from "node:crypto";
import type { BookingDeps } from "../booking/service";
import { getBusiness, getBusinessByPhone, type Business } from "../booking/repo";
import { ensureCall, logEvent, setOutcome } from "../agent/calls";
import { executeTool, type ToolOutput } from "../agent/tools";
import { TOOL_DEFINITIONS } from "../agent/tool-definitions";
import { buildSystemPrompt, SYSTEM_TOOLS } from "../agent/prompt";
import { summarizeFromEvents } from "../vapi/handler";
import { safeAlert } from "../agent/alerts";
import { decrypt, encrypt, safeEqual } from "../crypto";

/**
 * Adaptador para ElevenLabs Agents (voz alternativa a Vapi). La lógica de negocio es la misma
 * (src/server/agent): aquí solo se traduce el formato de ElevenLabs.
 *
 *  - POST /api/elevenlabs/init          → webhook de inicio de llamada (Twilio/SIP entrante)
 *  - POST /api/elevenlabs/tools/[tool]  → una herramienta "webhook" por cada herramienta del agente
 *  - POST /api/elevenlabs/post-call     → informe de fin de llamada (firmado con HMAC)
 */

export type ElevenLabsDeps = BookingDeps;

/** Autenticación de /init y /tools: cabecera Authorization: Bearer <ELEVENLABS_TOOLS_SECRET>. */
export function verifyBearer(headers: Headers, secret: string | undefined): boolean {
  if (!secret) return false;
  const auth = headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  return safeEqual(auth.slice(7).trim(), secret);
}

/**
 * Firma de los webhooks de ElevenLabs: cabecera "ElevenLabs-Signature: t=<segundos>,v0=<hex>",
 * con v0 = HMAC-SHA256(secreto, `${t}.${cuerpo}`). Mismo algoritmo que webhooks.constructEvent
 * del SDK oficial (@elevenlabs/elevenlabs-js), pero con comparación en tiempo constante.
 */
export function verifyElevenLabsSignature(rawBody: string, header: string | null, secret: string | undefined, nowMs = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",");
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v0 = parts.find((p) => p.startsWith("v0="));
  if (!t || !v0 || !/^\d+$/.test(t)) return false;
  const ts = Number(t) * 1000;
  if (ts < nowMs - 30 * 60_000 || ts > nowMs + 5 * 60_000) return false; // tolerancia de 30 min, como el SDK
  return safeEqual(v0, signElevenLabs(rawBody, t, secret));
}

export function signElevenLabs(rawBody: string, t: string, secret: string) {
  return `v0=${crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}

async function businessFor(deps: ElevenLabsDeps, agentId: unknown, calledNumber?: unknown): Promise<Business | null> {
  if (typeof agentId === "string" && agentId) {
    const r = await deps.db.query<{ id: string }>(`select id from businesses where elevenlabs_agent_id = $1`, [agentId]);
    if (r[0]) return getBusiness(deps.db, r[0].id);
  }
  if (typeof calledNumber === "string" && calledNumber) return getBusinessByPhone(deps.db, { number: calledNumber });
  return null;
}

// ---------------------------------------------------------------------------
// Inicio de llamada
// ---------------------------------------------------------------------------
/**
 * overrideFirstMessage: enviar también el saludo del negocio. En el plan Free de ElevenLabs solo se
 * permite sobrescribir prompt e idioma, y pedir otra sobrescritura podría hacer fallar la llamada,
 * así que por defecto NO se envía: el agente usa su propio saludo con la variable {{negocio}}.
 * Se activa con ELEVENLABS_OVERRIDE_FIRST_MESSAGE=1 (y permitiéndolo en la pestaña Security del agente).
 */
export async function handleInit(
  deps: ElevenLabsDeps,
  body: Record<string, unknown>,
  opts: { overrideFirstMessage?: boolean } = { overrideFirstMessage: process.env.ELEVENLABS_OVERRIDE_FIRST_MESSAGE === "1" },
) {
  const business = await businessFor(deps, body.agent_id, body.called_number);
  if (!business) {
    // Sin negocio no hay configuración que devolver: el agente usará su configuración base.
    return { type: "conversation_initiation_client_data", dynamic_variables: { negocio: "", transferencia: "no" } };
  }
  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : null;
  const callerId = typeof body.caller_id === "string" ? body.caller_id : null;
  if (conversationId) {
    const callId = await ensureCall(deps.db, { businessId: business.id, provider: "elevenlabs", providerCallId: conversationId, callerPhone: callerId, startedAt: deps.now() });
    // El teléfono lo da la telefonía (fiable). Se guarda cifrado solo durante la llamada.
    if (callerId) await deps.db.query(`update calls set caller_phone_enc = $2 where id = $1`, [callId, encrypt(callerId)]);
  }
  const { stable, volatile, transferPossible } = await buildSystemPrompt(deps.db, business, deps.now(), "phone", SYSTEM_TOOLS.elevenlabs);
  const firstMessage = business.welcome_message || `Hola, has llamado a ${business.name}. Soy ${business.agent_name}, la asistente virtual con inteligencia artificial. ¿En qué puedo ayudarte?`;
  return {
    type: "conversation_initiation_client_data",
    dynamic_variables: { negocio: business.name, transferencia: transferPossible ? "si" : "no" },
    conversation_config_override: {
      agent: {
        prompt: { prompt: `${stable}\n\n${volatile}` },
        language: "es",
        ...(opts.overrideFirstMessage ? { first_message: firstMessage } : {}),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------
const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.name));

export async function handleTool(deps: ElevenLabsDeps, toolName: string, body: Record<string, unknown>): Promise<ToolOutput> {
  if (!TOOL_NAMES.has(toolName as never)) return { ok: false, error: "herramienta_desconocida" };
  const business = await businessFor(deps, body.agent_id);
  if (!business) return { ok: false, error: "negocio_no_identificado", instruccion: "No confirmes nada y ofrece dejar un recado." };

  const conversationId = typeof body.conversation_id === "string" && body.conversation_id ? body.conversation_id : `sin-conversacion-${crypto.randomUUID()}`;
  // Las pruebas desde el navegador de ElevenLabs no pasan por /init: se crea la llamada sin teléfono.
  const callId = await ensureCall(deps.db, { businessId: business.id, provider: "elevenlabs", providerCallId: conversationId });
  const row = (await deps.db.query<{ caller_phone_enc: string | null; business_id: string }>(
    `select caller_phone_enc, business_id from calls where id = $1`, [callId],
  ))[0];
  if (row.business_id !== business.id) return { ok: false, error: "llamada_de_otro_negocio" };
  let callerPhone: string | null = null;
  try {
    callerPhone = row.caller_phone_enc ? decrypt(row.caller_phone_enc) : null;
  } catch {
    callerPhone = null;
  }

  // Solo los parámetros de la herramienta; conversation_id / agent_id / caller_id NUNCA llegan a la lógica.
  const { conversation_id: _c, agent_id: _a, caller_id: _p, ...args } = body;
  void _c; void _a; void _p;
  // Idempotencia: la misma petición repetida en la misma conversación devuelve lo mismo.
  const key = crypto.createHash("sha256").update(`${toolName}:${JSON.stringify(args)}`).digest("hex").slice(0, 24);
  return executeTool(
    { deps, businessId: business.id, callId, callerPhone, simulated: false, toolCallId: `el:${conversationId}:${key}` },
    toolName,
    args,
  );
}

// ---------------------------------------------------------------------------
// Fin de llamada (post_call_transcription)
// ---------------------------------------------------------------------------
type PostCall = {
  type?: string;
  data?: {
    agent_id?: string;
    conversation_id?: string;
    status?: string;
    transcript?: { tool_calls?: { tool_name?: string }[] | null }[];
    metadata?: { start_time_unix_secs?: number; call_duration_secs?: number; termination_reason?: string };
    analysis?: { transcript_summary?: string };
  };
};

export async function handlePostCall(deps: ElevenLabsDeps, event: PostCall): Promise<{ handled: boolean }> {
  if (event.type !== "post_call_transcription" || !event.data?.conversation_id) return { handled: false };
  const d = event.data;
  const conversationId = d.conversation_id!;
  const seen = await deps.db.query(`select 1 from webhook_events where provider = 'elevenlabs' and event_key = $1`, [`post:${conversationId}`]);
  if (seen.length) return { handled: true };
  const business = await businessFor(deps, d.agent_id);
  if (!business) return { handled: false };

  const callId = await ensureCall(deps.db, { businessId: business.id, provider: "elevenlabs", providerCallId: conversationId });
  const transferred = (d.transcript ?? []).some((t) => (t.tool_calls ?? []).some((c) => c?.tool_name === "transfer_to_number"));
  if (transferred) {
    await logEvent(deps.db, { businessId: business.id, callId, kind: "transfer", name: "transfer_to_number", detail: { ok: true } });
    await setOutcome(deps.db, callId, "transferred");
  }
  const startedAt = d.metadata?.start_time_unix_secs ? new Date(d.metadata.start_time_unix_secs * 1000) : null;
  const duration = typeof d.metadata?.call_duration_secs === "number" ? Math.round(d.metadata.call_duration_secs) : null;
  const failed = d.status === "failed";
  // Resumen en español a partir de lo que hizo el asistente. El de ElevenLabs llega en inglés por
  // defecto: solo se usa si la llamada no tuvo ninguna acción registrada.
  const toolEvents = await deps.db.query(`select 1 from call_events where call_id = $1 and kind in ('tool_result', 'transfer', 'error') limit 1`, [callId]);
  const summary = business.store_call_summaries
    ? (toolEvents.length || transferred ? await summarizeFromEvents(deps, callId) : d.analysis?.transcript_summary?.slice(0, 1000) || null)
    : null;
  let callerPhone: string | null = null;
  if (failed) {
    const enc = (await deps.db.query<{ caller_phone_enc: string | null }>(`select caller_phone_enc from calls where id = $1`, [callId]))[0]?.caller_phone_enc;
    try { callerPhone = enc ? decrypt(enc) : null; } catch { callerPhone = null; }
  }
  // No se guarda la transcripción. El teléfono cifrado se borra al terminar la llamada.
  await deps.db.query(
    `update calls set
       started_at = coalesce($2::timestamptz, started_at),
       duration_sec = coalesce($3::int, duration_sec),
       ended_at = coalesce($2::timestamptz, started_at) + (coalesce($3::int, 0) * interval '1 second'),
       ended_reason = $4,
       status = case when $5::boolean or status = 'transferred' then 'transferred' when $6::boolean then 'failed' else 'completed' end,
       outcome = coalesce(outcome, case when $6::boolean then 'error' else 'no_action' end),
       needs_review = needs_review or $6::boolean,
       summary = $7,
       caller_phone_enc = null
     where id = $1`,
    [callId, startedAt, duration, (d.metadata?.termination_reason ?? "").slice(0, 120), transferred, failed, summary],
  );
  if (failed) {
    await deps.db.query(`insert into issues (business_id, kind, message, call_id) values ($1, 'call_failed', $2, $3)`,
      [business.id, "La llamada terminó con error en ElevenLabs. Revisa si hay que devolverla.", callId]);
    await safeAlert(deps, { business, kind: "call_failed", phone: callerPhone, reason: `Error en la llamada (${d.metadata?.termination_reason ?? "sin detalle"})`, at: startedAt ?? deps.now() });
  }
  await deps.db.query(`insert into webhook_events (provider, event_key, business_id) values ('elevenlabs', $1, $2) on conflict do nothing`, [`post:${conversationId}`, business.id]);
  return { handled: true };
}
