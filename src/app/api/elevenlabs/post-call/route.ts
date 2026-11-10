import { NextResponse } from "next/server";
import { bookingDeps } from "@/server/deps";
import { env } from "@/server/env";
import { handlePostCall, verifyElevenLabsSignature } from "@/server/elevenlabs/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ElevenLabs: informe de fin de llamada. Se verifica la firma HMAC sobre el cuerpo en bruto. */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyElevenLabsSignature(raw, request.headers.get("elevenlabs-signature"), env.ELEVENLABS_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  try {
    const r = await handlePostCall(await bookingDeps(), JSON.parse(raw));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("[elevenlabs post-call]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
