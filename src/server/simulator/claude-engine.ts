import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFINITIONS } from "../agent/tool-definitions";
import type { ToolOutput } from "../agent/tools";
import type { TransferDecision } from "../agent/transfer";

/**
 * Simulador con Claude: mismo prompt, mismas herramientas y mismo modelo que el asistente telefónico
 * (Vapi usa el proveedor "anthropic"). Lo que se prueba aquí es lo que pasará en una llamada.
 */
const EXTRA_TOOLS: Anthropic.Tool[] = [
  {
    name: "transferCall",
    description: "Pasa la llamada a una persona del equipo. Úsala solo cuando la persona lo pida o no puedas resolverlo y ya le hayas dicho que la pasas.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "endCall",
    description: "Cuelga la llamada después de despedirte.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export const CLAUDE_TOOLS: Anthropic.Tool[] = [
  ...TOOL_DEFINITIONS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema })),
  ...EXTRA_TOOLS,
];

/** Chat web: las herramientas de agenda, sin transferir ni colgar. */
export const CHAT_TOOLS: Anthropic.Tool[] = CLAUDE_TOOLS.filter((t) => !EXTRA_TOOLS.some((x) => x.name === t.name));

export type ClaudeTurnInput = {
  apiKey: string;
  model: string;
  system: { stable: string; volatile: string };
  messages: Anthropic.MessageParam[];
  userText: string;
  exec: (name: string, args: Record<string, unknown>) => Promise<ToolOutput>;
  transfer?: () => Promise<TransferDecision>;
  tools?: Anthropic.Tool[];
};

export type ClaudeTurnOutput = { messages: Anthropic.MessageParam[]; replies: string[]; end?: "goodbye" | "transferred" };

/** Saldo agotado o clave inválida: aviso inmediato a Volkra (no al negocio), una vez por hora. */
async function alertIfAccountError(err: unknown) {
  try {
    const { isAnthropicAccountError, platformAlert } = await import("../platform-alerts");
    if (!isAnthropicAccountError(err)) return;
    const { getDb } = await import("../db");
    await platformAlert(await getDb(), {
      key: "anthropic-account",
      subject: "Claude no responde: saldo o clave de Anthropic",
      text: `El asistente no puede usar Claude, así que el chat web y WhatsApp no responden.\n\nError de Anthropic: ${(err as Error).message}\n\nRevisa el saldo y la clave en https://console.anthropic.com.`,
    });
  } catch {
    // Sin base de datos (tests) o sin email: no se avisa, pero el error sigue su curso.
  }
}

export async function claudeTurn(input: ClaudeTurnInput): Promise<ClaudeTurnOutput> {
  const client = new Anthropic({ apiKey: input.apiKey });
  const messages: Anthropic.MessageParam[] = [...input.messages, { role: "user", content: input.userText }];
  const replies: string[] = [];
  let end: ClaudeTurnOutput["end"];

  for (let i = 0; i < 8; i++) {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: input.model,
        max_tokens: 2000,
        // Parte estable cacheada (negocio, servicios, normas); la fecha y hora van aparte al final.
        system: [
          { type: "text", text: input.system.stable, cache_control: { type: "ephemeral" } },
          { type: "text", text: input.system.volatile },
        ],
        tools: input.tools ?? CLAUDE_TOOLS,
        // Respuestas rápidas, como en una llamada: poco razonamiento.
        output_config: { effort: "low" },
        messages,
      });
    } catch (err) {
      await alertIfAccountError(err);
      throw err;
    }
    messages.push({ role: "assistant", content: response.content });
    for (const b of response.content) if (b.type === "text" && b.text.trim()) replies.push(b.text.trim());

    if (response.stop_reason === "refusal") {
      replies.push("Perdona, con eso no puedo ayudarte. ¿Te ayudo con una cita o alguna duda?");
      break;
    }
    if (response.stop_reason !== "tool_use") break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      if (block.name === "endCall") {
        end = "goodbye";
        results.push({ type: "tool_result", tool_use_id: block.id, content: "Llamada finalizada." });
        continue;
      }
      if (block.name === "transferCall" && input.transfer) {
        const d = await input.transfer();
        if (d.transfer) end = "transferred";
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: d.transfer ? "Transferencia en curso." : `No se puede transferir (${d.reason}). Ofrece dejar un recado.`,
        });
        continue;
      }
      const out = await input.exec(block.name, (block.input ?? {}) as Record<string, unknown>);
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out), is_error: out.error === "error_tecnico" });
    }
    messages.push({ role: "user", content: results });
    if (end) break;
  }
  return { messages, replies, end };
}
