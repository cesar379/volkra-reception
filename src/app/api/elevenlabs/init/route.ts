import { NextResponse } from "next/server";
import { bookingDeps } from "@/server/deps";
import { env } from "@/server/env";
import { handleInit, verifyBearer } from "@/server/elevenlabs/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ElevenLabs: inicio de llamada entrante (Twilio/SIP). Devuelve el prompt del negocio y variables. */
export async function POST(request: Request) {
  if (!verifyBearer(request.headers, env.ELEVENLABS_TOOLS_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  try {
    return NextResponse.json(await handleInit(await bookingDeps(), body));
  } catch (err) {
    console.error("[elevenlabs init]", err);
    return NextResponse.json({ type: "conversation_initiation_client_data", dynamic_variables: { negocio: "", transferencia: "no" } });
  }
}
