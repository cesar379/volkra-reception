import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { createCheckout, getBilling, handleStripeEvent, signStripe, verifyStripeSignature } from "@/server/billing";
import { CLINIC, GARAGE, freshDb } from "./helpers";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => db.close());

const sub = (id: string, type: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  data: { object: { id: "sub_1", customer: "cus_1", status, current_period_end: 1_800_000_000, metadata: { business_id: CLINIC }, ...extra } },
});

describe("Stripe: firma del webhook", () => {
  it("acepta la firma correcta y rechaza otra, alterada o caducada", () => {
    const body = JSON.stringify({ id: "evt_1" });
    expect(verifyStripeSignature(body, signStripe(body, "whsec_x"), "whsec_x")).toBe(true);
    expect(verifyStripeSignature(body, signStripe(body, "otro"), "whsec_x")).toBe(false);
    expect(verifyStripeSignature(body + " ", signStripe(body, "whsec_x"), "whsec_x")).toBe(false);
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyStripeSignature(body, signStripe(body, "whsec_x", old), "whsec_x")).toBe(false);
    expect(verifyStripeSignature(body, null, "whsec_x")).toBe(false);
    expect(verifyStripeSignature(body, signStripe(body, "whsec_x"), undefined)).toBe(false);
  });
});

describe("Stripe: estado de la suscripción", () => {
  it("pago completado → suscripción activa → atrasada → cancelada", async () => {
    expect((await getBilling(db, CLINIC)).status).toBe("none");
    await handleStripeEvent(db, { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", customer: "cus_1", subscription: "sub_1", client_reference_id: CLINIC } } });
    expect(await getBilling(db, CLINIC)).toMatchObject({ status: "incomplete", stripe_customer_id: "cus_1" });

    await handleStripeEvent(db, sub("evt_2", "customer.subscription.updated", "active"));
    const b = await getBilling(db, CLINIC);
    expect(b.status).toBe("active");
    expect(b.current_period_end?.toISOString()).toBe(new Date(1_800_000_000 * 1000).toISOString());

    await handleStripeEvent(db, sub("evt_3", "customer.subscription.updated", "past_due"));
    expect((await getBilling(db, CLINIC)).status).toBe("past_due");
    await handleStripeEvent(db, sub("evt_4", "customer.subscription.deleted", "canceled"));
    expect((await getBilling(db, CLINIC)).status).toBe("canceled");
    expect((await getBilling(db, GARAGE)).status).toBe("none");
  });

  it("eventos repetidos o en desorden no estropean el estado", async () => {
    await handleStripeEvent(db, sub("evt_2", "customer.subscription.created", "active"));
    // El checkout llega después: no rebaja el estado
    await handleStripeEvent(db, { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", customer: "cus_1", subscription: "sub_1", client_reference_id: CLINIC } } });
    expect((await getBilling(db, CLINIC)).status).toBe("active");
    expect(await handleStripeEvent(db, sub("evt_2", "customer.subscription.created", "active"))).toBe("duplicate");
  });

  it("sin negocio en los metadatos, lo encuentra por el cliente de Stripe; si no, lo ignora", async () => {
    await handleStripeEvent(db, { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", customer: "cus_1", subscription: "sub_1", client_reference_id: CLINIC } } });
    expect(await handleStripeEvent(db, sub("evt_2", "customer.subscription.updated", "active", { metadata: {} }))).toBe("ok");
    expect((await getBilling(db, CLINIC)).status).toBe("active");
    expect(await handleStripeEvent(db, sub("evt_3", "customer.subscription.updated", "active", { metadata: {}, customer: "cus_otro" }))).toBe("ignored");
    expect(await handleStripeEvent(db, { id: "evt_4", type: "invoice.paid", data: { object: { id: "in_1" } } })).toBe("ignored");
  });
});

describe("Stripe: página de pago", () => {
  it("crea la sesión de suscripción con el precio, el negocio y las URLs de vuelta", async () => {
    let sent: { url: string; body: URLSearchParams; auth: string | null } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent = { url, body: new URLSearchParams(String(init.body)), auth: new Headers(init.headers).get("authorization") };
      return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_1" }), { status: 200 });
    }) as typeof fetch;
    const url = await createCheckout({ secret: "sk_test_x", priceId: "price_1", businessId: CLINIC, customerId: null, email: "dueño@clinica.test", appUrl: "https://entrada.volkra.es/" }, fakeFetch);
    expect(url).toBe("https://checkout.stripe.com/c/pay/cs_1");
    expect(sent!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(sent!.auth).toBe("Bearer sk_test_x");
    expect(sent!.body.get("mode")).toBe("subscription");
    expect(sent!.body.get("line_items[0][price]")).toBe("price_1");
    expect(sent!.body.get("subscription_data[metadata][business_id]")).toBe(CLINIC);
    expect(sent!.body.get("customer_email")).toBe("dueño@clinica.test");
    expect(sent!.body.get("success_url")).toBe("https://entrada.volkra.es/configuracion?tab=cuenta&pago=ok");
  });

  it("si Stripe responde con error, lo explica", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: { message: "No such price" } }), { status: 400 })) as unknown as typeof fetch;
    await expect(createCheckout({ secret: "sk", priceId: "x", businessId: CLINIC, customerId: "cus_1", email: null, appUrl: "https://x" }, fakeFetch)).rejects.toThrow(/No such price/);
  });
});
