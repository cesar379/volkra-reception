import crypto from "node:crypto";
import type { Queryable } from "./db/client";
import { safeEqual } from "./crypto";

/**
 * Cobro de la suscripción mensual con Stripe, sin SDK: la API REST de Stripe (form-encoded) y la
 * firma de sus webhooks (cabecera Stripe-Signature, HMAC-SHA256). El estado de cada negocio se guarda
 * en la tabla billing, que solo escribe el servidor al recibir los webhooks.
 */
export type BillingStatus = "none" | "incomplete" | "trialing" | "active" | "past_due" | "unpaid" | "canceled";
export type Billing = { status: BillingStatus; stripe_customer_id: string | null; current_period_end: Date | null };

export const BILLING_LABEL: Record<BillingStatus, string> = {
  none: "Sin suscripción",
  incomplete: "Pago pendiente",
  trialing: "En prueba",
  active: "Activa",
  past_due: "Pago atrasado",
  unpaid: "Impagada",
  canceled: "Cancelada",
};

export async function getBilling(q: Queryable, businessId: string): Promise<Billing> {
  const r = await q.query<Billing>(`select status, stripe_customer_id, current_period_end from billing where business_id = $1`, [businessId]);
  return r[0] ?? { status: "none", stripe_customer_id: null, current_period_end: null };
}

// ---------------------------------------------------------------------------
// API de Stripe
type Fetch = typeof fetch;

function form(params: Record<string, string>) {
  return new URLSearchParams(params).toString();
}

async function stripePost<T>(secret: string, path: string, params: Record<string, string>, f: Fetch = fetch): Promise<T> {
  const r = await f(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form(params),
  });
  const body = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${body.error?.message ?? "error"}`);
  return body;
}

/** Página de pago de Stripe para suscribirse. Devuelve la URL a la que redirigir. */
export async function createCheckout(
  p: { secret: string; priceId: string; businessId: string; customerId: string | null; email: string | null; appUrl: string },
  f: Fetch = fetch,
): Promise<string> {
  const base = p.appUrl.replace(/\/$/, "");
  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": p.priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: p.businessId,
    "metadata[business_id]": p.businessId,
    "subscription_data[metadata][business_id]": p.businessId,
    success_url: `${base}/configuracion?tab=cuenta&pago=ok`,
    cancel_url: `${base}/configuracion?tab=cuenta`,
    locale: "es",
    "automatic_tax[enabled]": "false",
    "tax_id_collection[enabled]": "true",
    billing_address_collection: "required",
  };
  if (p.customerId) params.customer = p.customerId;
  else if (p.email) params.customer_email = p.email;
  const s = await stripePost<{ url: string }>(p.secret, "checkout/sessions", params, f);
  return s.url;
}

/** Portal de cliente de Stripe: cambiar tarjeta, ver facturas, cancelar. */
export async function createPortal(p: { secret: string; customerId: string; appUrl: string }, f: Fetch = fetch): Promise<string> {
  const s = await stripePost<{ url: string }>(p.secret, "billing_portal/sessions", {
    customer: p.customerId,
    return_url: `${p.appUrl.replace(/\/$/, "")}/configuracion?tab=cuenta`,
    locale: "es",
  }, f);
  return s.url;
}

// ---------------------------------------------------------------------------
// Webhook
/** Cabecera "Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]". Rechaza firmas de más de 5 minutos. */
export function verifyStripeSignature(raw: string | Buffer, header: string | null, secret: string | undefined, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((x) => x.split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || sigs.length === 0 || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.`).update(raw).digest("hex");
  return sigs.some((s) => safeEqual(s, expected));
}

export function signStripe(raw: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
}

type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      customer?: string | null;
      subscription?: string | null;
      client_reference_id?: string | null;
      status?: string;
      current_period_end?: number;
      items?: { data?: { current_period_end?: number }[] };
      metadata?: Record<string, string>;
    };
  };
};

const STATUSES = new Set<BillingStatus>(["incomplete", "trialing", "active", "past_due", "unpaid", "canceled"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aplica un evento de Stripe. Idempotente: cada evento se procesa una vez (tabla webhook_events). */
export async function handleStripeEvent(q: Queryable, event: StripeEvent): Promise<"ok" | "duplicate" | "ignored"> {
  const o = event.data?.object;
  if (!o) return "ignored";
  const businessId = o.metadata?.business_id ?? o.client_reference_id ?? null;

  if (event.type === "checkout.session.completed") {
    if (!businessId || !UUID.test(businessId)) return "ignored";
    if (!(await firstTime(q, event.id, businessId))) return "duplicate";
    await q.query(
      `insert into billing (business_id, status, stripe_customer_id, stripe_subscription_id, updated_at)
       values ($1, 'incomplete', $2, $3, now())
       on conflict (business_id) do update set stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id, updated_at = now()`,
      [businessId, o.customer ?? null, o.subscription ?? null],
    );
    return "ok";
  }

  if (event.type.startsWith("customer.subscription.")) {
    // El negocio sale de los metadatos de la suscripción o, si no, del cliente de Stripe ya guardado.
    const bid = businessId && UUID.test(businessId)
      ? businessId
      : (await q.query<{ business_id: string }>(`select business_id from billing where stripe_customer_id = $1`, [o.customer ?? ""]))[0]?.business_id;
    if (!bid) return "ignored";
    if (!(await firstTime(q, event.id, bid))) return "duplicate";
    const status: BillingStatus = event.type === "customer.subscription.deleted" ? "canceled" : STATUSES.has(o.status as BillingStatus) ? (o.status as BillingStatus) : "incomplete";
    const end = o.current_period_end ?? o.items?.data?.[0]?.current_period_end;
    await q.query(
      `insert into billing (business_id, status, stripe_customer_id, stripe_subscription_id, current_period_end, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (business_id) do update set status = excluded.status,
         stripe_customer_id = coalesce(excluded.stripe_customer_id, billing.stripe_customer_id),
         stripe_subscription_id = excluded.stripe_subscription_id,
         current_period_end = excluded.current_period_end, updated_at = now()`,
      [bid, status, o.customer ?? null, o.id, end ? new Date(end * 1000) : null],
    );
    return "ok";
  }
  return "ignored";
}

async function firstTime(q: Queryable, eventId: string, businessId: string) {
  const r = await q.query(
    `insert into webhook_events (provider, event_key, business_id) values ('stripe', $1, $2) on conflict do nothing returning event_key`,
    [eventId, businessId],
  );
  return r.length > 0;
}
