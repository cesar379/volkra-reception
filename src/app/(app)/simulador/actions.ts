"use server";

import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { requireApp } from "@/server/auth";
import { bookingDeps } from "@/server/deps";
import { env } from "@/server/env";
import { endSimulation, sendSimulation, startSimulation, type SimReply } from "@/server/simulator/session";

export type SimResult = ({ ok: true } & SimReply) | { ok: false; message: string };

function friendly(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "La clave de Anthropic no es válida. Revisa ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError) return "Claude está recibiendo demasiadas peticiones. Prueba en unos segundos.";
  if (err instanceof Anthropic.APIError) return `Claude no ha respondido (error ${err.status}).`;
  console.error("[simulador]", err);
  return "Ha fallado el simulador. Inténtalo de nuevo.";
}

export async function simStart(): Promise<SimResult> {
  const ctx = await requireApp();
  try {
    return { ok: true, ...(await startSimulation(await bookingDeps(), ctx.business.id, { anthropicApiKey: env.ANTHROPIC_API_KEY })) };
  } catch (err) {
    return { ok: false, message: friendly(err) };
  }
}

export async function simSend(sessionId: string, text: string): Promise<SimResult> {
  const ctx = await requireApp();
  try {
    const r = await sendSimulation(await bookingDeps(), ctx.business.id, sessionId, text, { anthropicApiKey: env.ANTHROPIC_API_KEY });
    revalidatePath("/agenda");
    revalidatePath("/panel");
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, message: friendly(err) };
  }
}

export async function simEnd(sessionId: string): Promise<void> {
  const ctx = await requireApp();
  await endSimulation(await bookingDeps(), ctx.business.id, sessionId);
  revalidatePath("/llamadas");
  revalidatePath("/panel");
}

export type VoiceSession =
  | { ok: true; conversationToken?: string; agentId?: string; prompt: string; dynamicVariables: Record<string, string> }
  | { ok: false; message: string };

/**
 * Llamada de voz de prueba con el agente real de ElevenLabs del negocio.
 * Con ELEVENLABS_API_KEY se pide un token de conversación (agentes privados); sin ella, solo
 * funciona si el agente es público. Usa la agenda real: las citas que se reserven son reales.
 */
export async function voiceSession(): Promise<VoiceSession> {
  const ctx = await requireApp();
  const deps = await bookingDeps();
  const { getBusiness } = await import("@/server/booking/repo");
  const { buildSystemPrompt, SYSTEM_TOOLS } = await import("@/server/agent/prompt");
  const business = await getBusiness(deps.db, ctx.business.id);
  if (!business?.elevenlabs_agent_id) return { ok: false, message: "Este negocio no tiene agente de ElevenLabs." };
  const { stable, volatile, transferPossible } = await buildSystemPrompt(deps.db, business, new Date(), "phone", SYSTEM_TOOLS.elevenlabs);
  const base = { prompt: `${stable}\n\n${volatile}`, dynamicVariables: { negocio: business.name, transferencia: transferPossible ? "si" : "no" } };
  if (!env.ELEVENLABS_API_KEY) return { ok: true, agentId: business.elevenlabs_agent_id, ...base };
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(business.elevenlabs_agent_id)}`, {
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: { status?: string; message?: string } | string } | null;
    const d = body?.detail;
    const status = typeof d === "object" ? d?.status : undefined;
    if (status === "missing_permissions") return { ok: false, message: `Permiso insuficiente en la clave de ElevenLabs: ${typeof d === "object" && d?.message ? d.message : "ElevenAgents"}` };
    if (status === "invalid_api_key" || res.status === 401) return { ok: false, message: `Clave de ElevenLabs no válida (${status ?? res.status}). Revisa ELEVENLABS_API_KEY en Vercel.` };
    return { ok: false, message: `ElevenLabs respondió ${res.status}${status ? ` (${status})` : ""}.` };
  }
  const json = (await res.json()) as { token?: string };
  if (!json.token) return { ok: false, message: "ElevenLabs no devolvió token." };
  return { ok: true, conversationToken: json.token, ...base };
}
