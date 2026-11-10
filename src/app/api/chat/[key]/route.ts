import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { bookingDeps } from "@/server/deps";
import { env } from "@/server/env";
import { ChatError, claudeChatEngine, hashIp, sendChat } from "@/server/webchat/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS: Record<string, number> = { not_found: 404, limit: 429, busy: 409, ended: 410, empty: 400 };

/** Chat web público: un mensaje del visitante → respuestas del agente. */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!env.ANTHROPIC_API_KEY) return NextResponse.json({ ok: false, message: "Chat no disponible." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { sessionId?: unknown; text?: unknown } | null;
  if (!body || typeof body.text !== "string") return NextResponse.json({ ok: false, message: "Petición no válida." }, { status: 400 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  try {
    const r = await sendChat(
      await bookingDeps(),
      key,
      { sessionId: typeof body.sessionId === "string" ? body.sessionId : null, text: body.text, ipHash: hashIp(ip, env.APP_SECRET) },
      claudeChatEngine(env.ANTHROPIC_API_KEY),
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof ChatError) return NextResponse.json({ ok: false, code: err.code, message: err.message }, { status: STATUS[err.code] ?? 400 });
    if (err instanceof Anthropic.RateLimitError) return NextResponse.json({ ok: false, message: "Mucha demanda ahora mismo. Prueba en unos segundos." }, { status: 503 });
    console.error("[chat web]", err);
    return NextResponse.json({ ok: false, message: "No he podido responder. Inténtalo de nuevo." }, { status: 500 });
  }
}
