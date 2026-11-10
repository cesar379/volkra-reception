import { NextResponse } from "next/server";
import { bookingDeps } from "@/server/deps";
import { env } from "@/server/env";
import { handleTool, verifyBearer } from "@/server/elevenlabs/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** ElevenLabs: herramienta webhook. Siempre responde 200 con un objeto JSON (los errores van en el cuerpo). */
export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }) {
  if (!verifyBearer(request.headers, env.ELEVENLABS_TOOLS_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { tool } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return NextResponse.json(await handleTool(await bookingDeps(), tool, body ?? {}));
  } catch (err) {
    console.error(`[elevenlabs tool ${tool}]`, err);
    return NextResponse.json({ ok: false, error: "error_tecnico", instruccion: "No confirmes nada y ofrece dejar un recado." });
  }
}
