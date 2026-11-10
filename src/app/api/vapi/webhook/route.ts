import { NextResponse } from "next/server";
import { bookingDeps } from "@/server/deps";
import { env } from "@/server/env";
import { handleVapiMessage, verifyVapiRequest } from "@/server/vapi/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Servidor de Vapi: asistente por llamada, herramientas, transferencias y fin de llamada. */
export async function POST(request: Request) {
  if (!verifyVapiRequest(request.headers, env.VAPI_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const deps = await bookingDeps();
    const result = await handleVapiMessage({ ...deps, appUrl: env.APP_URL, webhookSecret: env.VAPI_WEBHOOK_SECRET }, body);
    return NextResponse.json(result ?? {});
  } catch (err) {
    console.error("[vapi webhook]", err);
    // Vapi solo tiene en cuenta respuestas 200: devolvemos un error legible para que el asistente lo gestione.
    const type = (body as { message?: { type?: string } })?.message?.type;
    if (type === "tool-calls") {
      const list = ((body as { message?: { toolCallList?: { id: string; function?: { name?: string } }[] } }).message?.toolCallList ?? []);
      return NextResponse.json({ results: list.map((tc) => ({ name: tc.function?.name ?? "", toolCallId: tc.id, error: "Error técnico. No confirmes nada y ofrece dejar un recado." })) });
    }
    return NextResponse.json({ error: "Ahora mismo no podemos atender la llamada. Por favor, inténtalo más tarde." });
  }
}
