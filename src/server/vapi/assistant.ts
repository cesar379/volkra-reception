import type { Queryable } from "../db/client";
import type { Business } from "../booking/repo";
import { buildSystemPrompt } from "../agent/prompt";
import { TOOL_DEFINITIONS } from "../agent/tool-definitions";

export type AssistantBuildOptions = { appUrl: string; webhookSecret: string; now: Date };

/**
 * Asistente "transitorio" que se devuelve a Vapi en cada llamada (assistant-request).
 * Ventaja: cada número usa siempre la configuración actual de su negocio, sin sincronizar nada en Vapi.
 * Todo el razonamiento lo hace Claude (proveedor "anthropic" de Vapi). Voz y transcripción: Azure y Deepgram.
 */
export async function buildVapiAssistant(q: Queryable, business: Business, opts: AssistantBuildOptions) {
  const { stable, volatile } = await buildSystemPrompt(q, business, opts.now, "phone");
  const server = {
    url: `${opts.appUrl.replace(/\/$/, "")}/api/vapi/webhook`,
    timeoutSeconds: 15,
    // Vapi no adjunta las credenciales de la organización a asistentes transitorios:
    // por eso el secreto va en las cabeceras de cada servidor.
    headers: { Authorization: `Bearer ${opts.webhookSecret}` },
  };

  const functionTools = TOOL_DEFINITIONS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
    server,
    // Los mensajes de espera por defecto de Vapi están en inglés: siempre los damos en español.
    messages: [{ type: "request-start" as const, content: t.waitMessage }],
  }));

  const model: Record<string, unknown> = {
    provider: "anthropic",
    model: business.voice_model,
    temperature: 0.3,
    maxTokens: 400,
    messages: [{ role: "system", content: `${stable}\n\n${volatile}` }],
    tools: [
      ...functionTools,
      // Sin destinos: Vapi pregunta a nuestro servidor (transfer-destination-request) y decidimos según horario.
      { type: "transferCall", messages: [{ type: "request-start", content: "Te paso con una persona del equipo, un momento." }] },
      { type: "endCall" },
    ],
  };
  // En Haiku 5.5 se puede elegir el esfuerzo de razonamiento; "none" minimiza la latencia.
  if (business.voice_model === "claude-haiku-5-5") model.reasoningEffort = "none";

  return {
    name: `${business.name}`.slice(0, 40),
    firstMessage: business.welcome_message || `Hola, has llamado a ${business.name}. Soy ${business.agent_name}, la asistente virtual con inteligencia artificial. ¿En qué puedo ayudarte?`,
    firstMessageMode: "assistant-speaks-first",
    model,
    transcriber: { provider: "deepgram", model: "nova-3", language: "es" },
    voice: { provider: "azure", voiceId: business.voice_id || "es-ES-ElviraNeural" },
    endCallMessage: "Gracias por llamar. ¡Hasta luego!",
    backgroundSound: "off",
    maxDurationSeconds: 900,
    // Interrupciones naturales: la persona puede cortar al asistente con pocas palabras.
    stopSpeakingPlan: { numWords: 1, voiceSeconds: 0.2, backoffSeconds: 1 },
    startSpeakingPlan: { waitSeconds: 0.4 },
    // Privacidad: sin grabación salvo que el negocio la active expresamente (y lo avise en la locución).
    artifactPlan: { recordingEnabled: business.recording_enabled },
    serverMessages: ["tool-calls", "end-of-call-report", "status-update", "transfer-destination-request"],
    server,
    metadata: { businessId: business.id },
  };
}
