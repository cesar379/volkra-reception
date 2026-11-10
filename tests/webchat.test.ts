import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { DEMO_USERS } from "@/server/db/seed";
import { getBusiness } from "@/server/booking/repo";
import { buildSystemPrompt } from "@/server/agent/prompt";
import { CHAT_LIMITS, ChatError, sendChat, type ChatEngine } from "@/server/webchat/session";
import { CLINIC, NOW, deps, freshDb } from "./helpers";

const KEY = "wc_clinicaTestKey0000000000";
let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`update businesses set web_chat_enabled = true, web_chat_key = $2 where id = $1`, [CLINIC, KEY]);
});
afterEach(async () => db.close());

/** Motor falso: en vez de Claude, ejecuta las herramientas que diga cada prueba y devuelve su resultado. */
type Step = { tool: string; args: Record<string, unknown> };
function engine(plan: (text: string) => Step[], results: Record<string, unknown>[] = []): ChatEngine {
  return async ({ messages, userText, exec }) => {
    const replies: string[] = [];
    for (const s of plan(userText)) {
      const out = await exec(s.tool, s.args);
      results.push(out);
      replies.push(`${s.tool}: ${out.ok ? "ok" : out.error}`);
    }
    return { messages: [...messages, { role: "user", content: userText }, { role: "assistant", content: replies.join(" | ") || "vale" }], replies };
  };
}
const say = (text: string, sessionId?: string, ip = "ip-1") => ({ text, sessionId, ipHash: ip });

async function firstSlot() {
  const results: Record<string, unknown>[] = [];
  await sendChat(deps(db), KEY, say("huecos"), engine(() => [{ tool: "buscar_huecos", args: { servicio: "revisión", dia: "el jueves 5 de noviembre" } }], results), );
  return (results[0].opciones as { inicio: string }[]).map((o) => o.inicio);
}

describe("Chat web", () => {
  it("código desconocido o chat desactivado: no responde", async () => {
    const e = engine(() => []);
    await expect(sendChat(deps(db), "wc_noExisteEsteCodigo00000", say("hola"), e)).rejects.toMatchObject({ code: "not_found" });
    await expect(sendChat(deps(db), "' or 1=1 --", say("hola"), e)).rejects.toMatchObject({ code: "not_found" });
    await db.query(`update businesses set web_chat_enabled = false where id = $1`, [CLINIC]);
    await expect(sendChat(deps(db), KEY, say("hola"), e)).rejects.toBeInstanceOf(ChatError);
  });

  it("reserva real con el teléfono que da la persona y queda en el historial como chat", async () => {
    const slots = await firstSlot();
    const results: Record<string, unknown>[] = [];
    const r = await sendChat(deps(db), KEY, say("reserva"), engine(() => [
      { tool: "reservar_cita", args: { servicio: "Revisión y diagnóstico", inicio: slots[0], nombre: "Sin Teléfono" } },
      { tool: "reservar_cita", args: { servicio: "Revisión y diagnóstico", inicio: slots[0], nombre: "Ana Chat", telefono: "600 111 222" } },
    ], results));
    expect(results[0].error).toBe("falta_telefono"); // sin llamada no hay teléfono: hay que pedirlo
    expect(results[1].ok).toBe(true);
    const appt = await db.query<{ source: string; phone: string }>(
      `select a.source, c.phone from appointments a join customers c on c.id = a.customer_id where c.name = 'Ana Chat'`,
    );
    expect(appt[0]).toEqual({ source: "ai_call", phone: "+34600111222" });
    const call = await db.query<{ provider: string; outcome: string; status: string; summary: string; caller_last4: string | null; is_simulated: boolean }>(
      `select c.provider, c.outcome, c.status, c.summary, c.caller_last4, c.is_simulated from calls c join chat_sessions s on s.call_id = c.id where s.id = $1`,
      [r.sessionId],
    );
    expect(call[0]).toMatchObject({ provider: "web", outcome: "booked", status: "completed", caller_last4: null, is_simulated: false });
    expect(call[0].summary).toMatch(/Reserva/);
  });

  it("el teléfono que escribe el visitante no sirve para ver citas ajenas", async () => {
    const slots = await firstSlot();
    const results: Record<string, unknown>[] = [];
    await sendChat(deps(db), KEY, say("x"), engine(() => [
      { tool: "reservar_cita", args: { servicio: "Revisión y diagnóstico", inicio: slots[0], nombre: "Eva Víctima", telefono: "600333444" } },
      { tool: "buscar_mis_citas", args: { telefono: "600333444" } },
      { tool: "cancelar_cita", args: { cita: "XXXXXX", nombre: "Otra" } },
    ], results), );
    expect(results[1].error).toBe("verificacion_necesaria");
    expect(results[2].error).toBe("verificacion_necesaria");
    // Con código y nombre correctos sí puede gestionar su cita
    const code = results[0].codigo as string;
    const own: Record<string, unknown>[] = [];
    await sendChat(deps(db), KEY, say("y", undefined, "ip-2"), engine(() => [{ tool: "buscar_mis_citas", args: { codigo: code, nombre: "Eva" } }], own));
    expect((own[0].citas as unknown[]).length).toBe(1);
  });

  it("límites: reservas y recados por conversación, turnos y conversaciones por IP", async () => {
    const slots = await firstSlot();
    const results: Record<string, unknown>[] = [];
    const r = await sendChat(deps(db), KEY, say("spam"), engine(() => [
      { tool: "reservar_cita", args: { servicio: "Revisión y diagnóstico", inicio: slots[0], nombre: "Uno Spam", telefono: "600000001" } },
      { tool: "dejar_recado", args: { nombre: "Dos Spam", motivo: "x", telefono: "600000002" } },
      { tool: "reservar_cita", args: { servicio: "Revisión y diagnóstico", inicio: slots[1], nombre: "Tres Spam", telefono: "600000003" } },
    ], results));
    expect(results.map((x) => x.ok)).toEqual([true, true, false]);
    expect(results[2].error).toBe("limite_alcanzado");
    expect((await db.query<{ n: number }>(`select count(*)::int n from customers where name = 'Tres Spam'`))[0].n).toBe(0);

    // Límite de turnos: la conversación termina
    await db.query(`update chat_sessions set turns = $2 where id = $1`, [r.sessionId, CHAT_LIMITS.maxTurns]);
    await expect(sendChat(deps(db), KEY, say("otra", r.sessionId), engine(() => []))).rejects.toMatchObject({ code: "ended" });

    // Conversaciones nuevas desde la misma IP en una hora
    for (let i = 0; i < CHAT_LIMITS.sessionsPerIpHour - 2; i++) await sendChat(deps(db), KEY, say("hola", undefined, "ip-3"), engine(() => []));
    await sendChat(deps(db), KEY, say("hola", undefined, "ip-3"), engine(() => []));
    await sendChat(deps(db), KEY, say("hola", undefined, "ip-3"), engine(() => []));
    await expect(sendChat(deps(db), KEY, say("hola", undefined, "ip-3"), engine(() => []))).rejects.toMatchObject({ code: "limit" });
  });

  it("un turno a la vez y conversaciones de otro negocio no se pueden reutilizar", async () => {
    const r = await sendChat(deps(db), KEY, say("hola"), engine(() => []));
    await db.query(`update chat_sessions set busy_until = $2 where id = $1`, [r.sessionId, new Date(NOW.getTime() + 30_000)]);
    await expect(sendChat(deps(db), KEY, say("otra", r.sessionId), engine(() => []))).rejects.toMatchObject({ code: "busy" });
    // Un id de conversación inválido o ajeno abre una conversación nueva, no reutiliza la otra
    const garageKey = "wc_tallerTestKey00000000000";
    await db.query(`update businesses set web_chat_enabled = true, web_chat_key = $1 where id <> $2`, [garageKey, CLINIC]);
    const g = await sendChat(deps(db), garageKey, say("hola", r.sessionId), engine(() => []));
    expect(g.sessionId).not.toBe(r.sessionId);
    const n = await sendChat(deps(db), KEY, say("hola", "no-es-un-uuid"), engine(() => []));
    expect(n.sessionId).not.toBe(r.sessionId);
  });

  it("prompt del chat: pide teléfono, no transfiere y no habla como por teléfono", async () => {
    const b = (await getBusiness(db, CLINIC))!;
    const { stable, transferPossible } = await buildSystemPrompt(db, b, NOW, "chat");
    expect(stable).toContain("chat de la web");
    expect(stable).toContain("teléfono de contacto");
    expect(stable).toContain("ya ha dicho que no quiere correo");
    expect(stable).not.toContain("transferCall");
    expect(transferPossible).toBe(false);
  });

  it("las conversaciones no son legibles desde el panel ni por usuarios", async () => {
    await sendChat(deps(db), KEY, say("hola"), engine(() => []));
    await expect(db.asUser(DEMO_USERS.clinic.id, (q) => q.query(`select * from chat_sessions`))).rejects.toThrow(/permission denied/);
  });
});
