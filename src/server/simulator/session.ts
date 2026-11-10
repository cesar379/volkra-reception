import crypto from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { BookingDeps } from "../booking/service";
import { getBusiness, listServices } from "../booking/repo";
import { ensureCall } from "../agent/calls";
import { executeTool } from "../agent/tools";
import { decideTransfer } from "../agent/transfer";
import { buildSystemPrompt } from "../agent/prompt";
import { summarizeFromEvents } from "../vapi/handler";
import { scriptTurn, type ScriptState } from "./script-engine";
import { claudeTurn } from "./claude-engine";

/** Teléfono ficticio con el que "llama" el simulador (se guarda solo como últimos 4 dígitos). */
export const SIMULATOR_PHONE = "+34000000099";

export type SimEvent = { name: string; ok: boolean | null; summary: string | null; kind: string };
export type SimReply = { sessionId: string; replies: string[]; events: SimEvent[]; ended: boolean; endReason?: string; mode: "claude" | "script" };

type Options = { anthropicApiKey?: string; model?: string };

export async function startSimulation(deps: BookingDeps, businessId: string, opts: Options): Promise<SimReply> {
  const business = await getBusiness(deps.db, businessId);
  if (!business) throw new Error("Negocio no encontrado");
  const mode = opts.anthropicApiKey ? "claude" : "script";
  const providerCallId = `sim-${crypto.randomUUID()}`;
  const callId = await ensureCall(deps.db, { businessId, provider: "simulator", providerCallId, callerPhone: SIMULATOR_PHONE, simulated: true, startedAt: deps.now() });
  const greeting = business.welcome_message || `Hola, has llamado a ${business.name}. Soy ${business.agent_name}, la asistente virtual con inteligencia artificial. ¿En qué puedo ayudarte?`;
  // El saludo inicial forma parte de la conversación para que Claude sepa que ya se presentó.
  const messages: Anthropic.MessageParam[] = mode === "claude" ? [{ role: "user", content: "(La llamada acaba de empezar.)" }, { role: "assistant", content: greeting }] : [];
  const r = await deps.db.query<{ id: string }>(
    `insert into simulator_sessions (business_id, call_id, mode, messages, state) values ($1, $2, $3, $4::jsonb, $5::jsonb) returning id`,
    [businessId, callId, mode, JSON.stringify(messages), JSON.stringify({ step: "idle" })],
  );
  return { sessionId: r[0].id, replies: [greeting], events: [], ended: false, mode };
}

export async function sendSimulation(deps: BookingDeps, businessId: string, sessionId: string, text: string, opts: Options): Promise<SimReply> {
  const session = (await deps.db.query<{ id: string; call_id: string; mode: "claude" | "script"; messages: Anthropic.MessageParam[]; state: ScriptState; ended: boolean }>(
    `select id, call_id, mode, messages, state, ended from simulator_sessions where id = $1 and business_id = $2`,
    [sessionId, businessId],
  ))[0];
  if (!session) throw new Error("Conversación no encontrada");
  if (session.ended) return { sessionId, replies: ["Esta llamada ya ha terminado. Empieza una nueva."], events: [], ended: true, mode: session.mode };
  const business = (await getBusiness(deps.db, businessId))!;
  const turnStart = new Date(Date.now() - 1);
  const ctx = { deps, businessId, callId: session.call_id, callerPhone: SIMULATOR_PHONE, simulated: true };
  const exec = (name: string, args: Record<string, unknown>) => executeTool({ ...ctx, toolCallId: `sim-${crypto.randomUUID()}` }, name, args);
  const transfer = () => decideTransfer(deps, business, session.call_id);
  const clean = text.trim().slice(0, 500);

  let replies: string[] = [];
  let end: string | undefined;
  if (session.mode === "claude" && opts.anthropicApiKey) {
    const system = await buildSystemPrompt(deps.db, business, deps.now(), "simulator");
    const out = await claudeTurn({ apiKey: opts.anthropicApiKey, model: opts.model ?? business.voice_model, system, messages: session.messages, userText: clean, exec, transfer });
    replies = out.replies;
    end = out.end;
    await deps.db.query(`update simulator_sessions set messages = $2::jsonb, updated_at = now() where id = $1`, [sessionId, JSON.stringify(out.messages)]);
  } else {
    const services = await listServices(deps.db, businessId);
    const out = await scriptTurn(session.state ?? { step: "idle" }, clean, { exec, transfer, services, now: deps.now(), tz: business.timezone });
    replies = out.replies;
    end = out.end;
    await deps.db.query(`update simulator_sessions set state = $2::jsonb, updated_at = now() where id = $1`, [sessionId, JSON.stringify(out.state)]);
  }

  const events = await deps.db.query<{ kind: string; name: string; detail: { ok?: boolean; resumen?: string } }>(
    `select kind, name, detail from call_events where call_id = $1 and at >= $2 and kind in ('tool_result', 'transfer', 'error') order by at`,
    [session.call_id, turnStart],
  );
  if (end) await endSimulation(deps, businessId, sessionId, end);
  return {
    sessionId,
    replies,
    events: events.map((e) => ({ kind: e.kind, name: e.name, ok: e.detail?.ok ?? null, summary: e.detail?.resumen ?? null })),
    ended: Boolean(end),
    endReason: end,
    mode: session.mode,
  };
}

/** Cierra la llamada simulada: duración, estado, resultado y resumen (igual que un fin de llamada real). */
export async function endSimulation(deps: BookingDeps, businessId: string, sessionId: string, reason = "colgó") {
  const s = (await deps.db.query<{ call_id: string; ended: boolean }>(`select call_id, ended from simulator_sessions where id = $1 and business_id = $2`, [sessionId, businessId]))[0];
  if (!s || s.ended) return;
  const summary = await summarizeFromEvents(deps, s.call_id);
  await deps.db.query(
    `update calls set ended_at = $2,
            duration_sec = greatest(0, extract(epoch from ($2::timestamptz - started_at))::int),
            ended_reason = $3,
            status = case when status = 'transferred' or outcome = 'transferred' then 'transferred' when needs_review then 'failed' else 'completed' end,
            outcome = coalesce(outcome, 'no_action'),
            summary = $4
      where id = $1`,
    [s.call_id, deps.now(), `simulador: ${reason}`, summary],
  );
  await deps.db.query(`update simulator_sessions set ended = true, updated_at = now() where id = $1`, [sessionId]);
}
