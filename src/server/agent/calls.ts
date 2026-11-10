import type { Queryable } from "../db/client";

export type Outcome = "booked" | "rescheduled" | "cancelled" | "info" | "transferred" | "message" | "no_action" | "error";

/** Si en una llamada pasan varias cosas, el resultado que se muestra es el más relevante. */
const PRIORITY: Outcome[] = ["booked", "rescheduled", "cancelled", "transferred", "message", "error", "info", "no_action"];

export function strongerOutcome(a: Outcome | null | undefined, b: Outcome): Outcome {
  if (!a) return b;
  return PRIORITY.indexOf(b) < PRIORITY.indexOf(a) ? b : a;
}

export function last4(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
}

/** Crea (o recupera) el registro de una llamada. Idempotente por (proveedor, id de llamada). */
export async function ensureCall(
  q: Queryable,
  c: { businessId: string; provider: "vapi" | "simulator" | "elevenlabs" | "web" | "whatsapp"; providerCallId: string; callerPhone?: string | null; startedAt?: Date | null; simulated?: boolean },
): Promise<string> {
  const r = await q.query<{ id: string }>(
    `insert into calls (business_id, provider, provider_call_id, started_at, caller_last4, is_simulated)
     values ($1, $2, $3, coalesce($4, now()), $5, $6)
     on conflict (provider, provider_call_id) do update set provider_call_id = excluded.provider_call_id
     returning id`,
    [c.businessId, c.provider, c.providerCallId, c.startedAt ?? null, last4(c.callerPhone), Boolean(c.simulated)],
  );
  return r[0].id;
}

export async function setOutcome(q: Queryable, callId: string, outcome: Outcome) {
  const r = await q.query<{ outcome: Outcome | null }>(`select outcome from calls where id = $1`, [callId]);
  const next = strongerOutcome(r[0]?.outcome, outcome);
  await q.query(`update calls set outcome = $2 where id = $1`, [callId, next]);
}

/** Registro de lo que hace el agente. Nunca guarda teléfonos ni emails. */
export async function logEvent(
  q: Queryable,
  e: { businessId: string; callId: string; kind: "tool_call" | "tool_result" | "transfer" | "error" | "message"; name?: string; detail?: Record<string, unknown> },
) {
  await q.query(`insert into call_events (business_id, call_id, kind, name, detail) values ($1, $2, $3, $4, $5::jsonb)`, [
    e.businessId,
    e.callId,
    e.kind,
    e.name ?? "",
    JSON.stringify(redact(e.detail ?? {})),
  ]);
}

const SENSITIVE = new Set(["telefono", "email", "phone", "customer_phone"]);
export function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE.has(k)) out[k] = v ? "[oculto]" : v;
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redact(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}
