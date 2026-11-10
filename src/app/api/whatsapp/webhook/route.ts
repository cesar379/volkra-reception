import { after, NextResponse } from "next/server";
import { bookingDeps } from "@/server/deps";
import { env } from "@/server/env";
import { claudeChatEngine } from "@/server/webchat/session";
import { graphSender, handleInbound, takeInbound, verifyMetaSignature, verifySubscription } from "@/server/whatsapp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Meta comprueba la URL al suscribir el webhook. */
export async function GET(request: Request) {
  const challenge = verifySubscription(new URL(request.url).searchParams, env.WHATSAPP_VERIFY_TOKEN);
  return challenge ? new Response(challenge, { status: 200 }) : new Response("Forbidden", { status: 403 });
}

/**
 * Mensajes entrantes. Se responde 200 enseguida (si no, Meta reintenta) y el agente
 * contesta después, con after(). Cada mensaje se procesa una sola vez.
 */
export async function POST(request: Request) {
  const raw = Buffer.from(await request.arrayBuffer());
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), env.WHATSAPP_APP_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const deps = await bookingDeps();
  const inbound = await takeInbound(deps, payload);
  if (inbound.length && env.ANTHROPIC_API_KEY) {
    const opts = {
      engine: claudeChatEngine(env.ANTHROPIC_API_KEY),
      sender: graphSender({ baseUrl: env.WHATSAPP_GRAPH_URL, version: env.WHATSAPP_GRAPH_VERSION }),
      secret: env.APP_SECRET,
      fallbackToken: env.WHATSAPP_ACCESS_TOKEN,
    };
    after(async () => {
      for (const m of inbound) await handleInbound(deps, m, opts);
    });
  } else if (inbound.length) {
    console.error("[whatsapp] Falta ANTHROPIC_API_KEY: no se puede responder");
  }
  return NextResponse.json({ ok: true });
}
