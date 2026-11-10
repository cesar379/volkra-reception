import crypto from "node:crypto";
import type { BookingDeps } from "../booking/service";
import { getBusiness, getBusinessByPhone, type Business } from "../booking/repo";
import { ensureCall, setOutcome } from "../agent/calls";
import { executeTool } from "../agent/tools";
import { decideTransfer } from "../agent/transfer";
import { safeAlert } from "../agent/alerts";
import { buildVapiAssistant } from "./assistant";

export type VapiDeps = BookingDeps & { appUrl: string; webhookSecret: string | undefined };

/** Comprueba que la petición viene de Vapi: Authorization: Bearer <secreto> o X-Vapi-Secret (comparación en tiempo constante). */
export function verifyVapiRequest(headers: Headers, secret: string | undefined): boolean {
  if (!secret) return false;
  const auth = headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const legacy = headers.get("x-vapi-secret") ?? "";
  return [bearer, legacy].some((v) => v.length > 0 && safeEqual(v, secret));
}

function safeEqual(a: string, b: string) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

type VapiCall = {
  id?: string;
  phoneNumberId?: string;
  startedAt?: string;
  endedAt?: string;
  customer?: { number?: string };
  assistant?: { metadata?: Record<string, unknown> };
  assistantOverrides?: { metadata?: Record<string, unknown> };
};
type VapiMessage = {
  type?: string;
  call?: VapiCall;
  phoneNumber?: { id?: string; number?: string };
  assistant?: { metadata?: Record<string, unknown> };
  customer?: { number?: string };
  status?: string;
  endedReason?: string;
  startedAt?: string;
  endedAt?: string;
  analysis?: { summary?: string };
  toolCallList?: { id: string; type?: string; function?: { name: string; arguments?: unknown } }[];
  destination?: { number?: string };
};

async function resolveBusiness(deps: VapiDeps, m: VapiMessage): Promise<Business | null> {
  const byPhone = await getBusinessByPhone(deps.db, {
    phoneNumberId: m.phoneNumber?.id ?? m.call?.phoneNumberId ?? null,
    number: m.phoneNumber?.number ?? null,
  });
  if (byPhone) return byPhone;
  // Llamadas web/de prueba sin número: el negocio viaja en los metadatos del asistente que generamos nosotros.
  const meta = m.assistant?.metadata ?? m.call?.assistant?.metadata ?? m.call?.assistantOverrides?.metadata;
  const id = typeof meta?.businessId === "string" ? meta.businessId : null;
  return id && /^[0-9a-f-]{36}$/i.test(id) ? getBusiness(deps.db, id) : null;
}

function callerOf(m: VapiMessage): string | null {
  return m.call?.customer?.number ?? m.customer?.number ?? null;
}

/** Procesa un mensaje del servidor de Vapi. Siempre devuelve 200 salvo autenticación (Vapi ignora otros códigos). */
export async function handleVapiMessage(deps: VapiDeps, body: unknown): Promise<unknown> {
  const m = ((body as { message?: VapiMessage })?.message ?? {}) as VapiMessage;
  const business = await resolveBusiness(deps, m);
  const providerCallId = m.call?.id;

  switch (m.type) {
    case "assistant-request": {
      if (!business) return { error: "Lo sentimos, este número todavía no está configurado." };
      if (!deps.webhookSecret) return { error: "Servicio no configurado." };
      if (providerCallId) {
        await ensureCall(deps.db, { businessId: business.id, provider: "vapi", providerCallId, callerPhone: callerOf(m), startedAt: new Date() });
      }
      return { assistant: await buildVapiAssistant(deps.db, business, { appUrl: deps.appUrl, webhookSecret: deps.webhookSecret, now: deps.now() }) };
    }

    case "tool-calls": {
      const list = m.toolCallList ?? [];
      if (!business || !providerCallId) {
        return { results: list.map((tc) => ({ name: tc.function?.name ?? "", toolCallId: tc.id, error: "Negocio no identificado" })) };
      }
      const callId = await ensureCall(deps.db, { businessId: business.id, provider: "vapi", providerCallId, callerPhone: callerOf(m) });
      const results = [];
      for (const tc of list) {
        const name = tc.function?.name ?? "";
        const eventKey = `tool:${tc.id}`;
        // Reintento del mismo webhook: devolver exactamente la misma respuesta, sin volver a ejecutar.
        const cached = await deps.db.query<{ response: { result: string } | null }>(
          `select response from webhook_events where provider = 'vapi' and event_key = $1`, [eventKey],
        );
        if (cached[0]?.response) {
          results.push({ name, toolCallId: tc.id, result: cached[0].response.result });
          continue;
        }
        let args: unknown = tc.function?.arguments ?? {};
        if (typeof args === "string") {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        const out = await executeTool(
          { deps, businessId: business.id, callId, callerPhone: callerOf(m), simulated: false, toolCallId: tc.id },
          name,
          args,
        );
        const result = JSON.stringify(out); // Vapi exige un texto plano de una línea
        const stored = await deps.db.query<{ response: { result: string } }>(
          `insert into webhook_events (provider, event_key, business_id, response) values ('vapi', $1, $2, $3::jsonb)
           on conflict (provider, event_key) do update set event_key = excluded.event_key
           returning response`,
          [eventKey, business.id, JSON.stringify({ result })],
        );
        results.push({ name, toolCallId: tc.id, result: stored[0]?.response?.result ?? result });
      }
      return { results };
    }

    case "transfer-destination-request": {
      if (!business) return { error: "No se puede transferir la llamada." };
      const callId = providerCallId
        ? await ensureCall(deps.db, { businessId: business.id, provider: "vapi", providerCallId, callerPhone: callerOf(m) })
        : null;
      const d = await decideTransfer(deps, business, callId);
      if (d.transfer) return { destination: { type: "number", number: d.number, message: d.message } };
      return { error: d.message };
    }

    case "status-update": {
      if (!business || !providerCallId) return {};
      const callId = await ensureCall(deps.db, { businessId: business.id, provider: "vapi", providerCallId, callerPhone: callerOf(m) });
      if (m.status === "forwarding") {
        await deps.db.query(`update calls set status = 'transferred' where id = $1`, [callId]);
        await setOutcome(deps.db, callId, "transferred");
      }
      return {};
    }

    case "end-of-call-report": {
      if (!business || !providerCallId) return {};
      const eventKey = `eocr:${providerCallId}`;
      const seen = await deps.db.query(`select 1 from webhook_events where provider = 'vapi' and event_key = $1`, [eventKey]);
      if (seen.length) return {};
      const callId = await ensureCall(deps.db, { businessId: business.id, provider: "vapi", providerCallId, callerPhone: callerOf(m) });
      const startedAt = parseDate(m.startedAt ?? m.call?.startedAt);
      const endedAt = parseDate(m.endedAt ?? m.call?.endedAt) ?? deps.now();
      const reason = m.endedReason ?? "";
      const failed = /error|failed|fault|pipeline/i.test(reason);
      const summary = business.store_call_summaries ? (m.analysis?.summary?.slice(0, 1000) || (await summarizeFromEvents(deps, callId))) : null;
      await deps.db.query(
        `update calls set
           started_at = coalesce($2, started_at),
           ended_at = $3,
           duration_sec = greatest(0, extract(epoch from ($3::timestamptz - coalesce($2, started_at)))::int),
           ended_reason = $4,
           status = case when status = 'transferred' or outcome = 'transferred' then 'transferred' when $5 then 'failed' else 'completed' end,
           outcome = coalesce(outcome, case when $5 then 'error' else 'no_action' end),
           needs_review = needs_review or $5,
           summary = $6
         where id = $1`,
        [callId, startedAt, endedAt, reason.slice(0, 120), failed, summary],
      );
      if (failed) {
        await deps.db.query(
          `insert into issues (business_id, kind, message, call_id) values ($1, 'call_failed', $2, $3)`,
          [business.id, `La llamada terminó por un fallo técnico (${reason}). Revisa si hay que devolverla.`, callId],
        );
        await safeAlert(deps, { business, kind: "call_failed", phone: callerOf(m), reason: `Fallo técnico (${reason})`, at: startedAt ?? deps.now() });
      }
      await deps.db.query(`insert into webhook_events (provider, event_key, business_id) values ('vapi', $1, $2) on conflict do nothing`, [eventKey, business.id]);
      return {};
    }

    default:
      return {};
  }
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Resumen sin IA a partir de lo que hizo el agente (no requiere guardar la transcripción). */
export async function summarizeFromEvents(deps: BookingDeps, callId: string): Promise<string> {
  const ev = await deps.db.query<{ kind: string; name: string; detail: { ok?: boolean; resumen?: string | null } }>(
    `select kind, name, detail from call_events where call_id = $1 and kind in ('tool_result', 'transfer', 'error') order by at`,
    [callId],
  );
  if (ev.length === 0) return "Conversación sin acciones en la agenda.";
  const parts = ev.map((e) => {
    if (e.kind === "transfer") return "Se pidió hablar con una persona";
    if (e.kind === "error") return `Error técnico en ${e.name}`;
    const label: Record<string, string> = {
      buscar_huecos: "Consultó disponibilidad", reservar_cita: "Reserva", buscar_mis_citas: "Buscó sus citas",
      cambiar_cita: "Cambio de cita", cancelar_cita: "Cancelación", consultar_informacion: "Pregunta de información", dejar_recado: "Dejó un recado",
    };
    return `${label[e.name] ?? e.name}${e.detail?.resumen ? ` (${e.detail.resumen})` : ""}${e.detail?.ok === false ? " – sin éxito" : ""}`;
  });
  return [...new Set(parts)].join(". ") + ".";
}
