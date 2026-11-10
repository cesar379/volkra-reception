import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { env } from "@/server/env";
import { handleStripeEvent, verifyStripeSignature } from "@/server/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Webhook de Stripe: altas, cambios y bajas de la suscripción de cada negocio. */
export async function POST(request: Request) {
  const raw = Buffer.from(await request.arrayBuffer());
  if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  let event: Parameters<typeof handleStripeEvent>[1];
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const result = await handleStripeEvent(await getDb(), event);
  return NextResponse.json({ ok: true, result });
}
