import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import type { ChatEngine } from "@/server/webchat/session";
import { encrypt } from "@/server/crypto";
import { getBusiness } from "@/server/booking/repo";
import { buildSystemPrompt } from "@/server/agent/prompt";
import { purgeChatContent } from "@/server/webchat/session";
import {
  handleInbound,
  purgeWhatsAppInbound,
  signMeta,
  takeInbound,
  verifyMetaSignature,
  verifySubscription,
  WHATSAPP_TEXT,
  type Inbound,
  type WhatsAppSender,
} from "@/server/whatsapp/handler";
import { CLINIC, GARAGE, NOW, deps, freshDb } from "./helpers";

const PHONE_ID = "109876543210";
let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`update businesses set whatsapp_enabled = true, whatsapp_phone_number_id = $2 where id = $1`, [CLINIC, PHONE_ID]);
  await db.query(`insert into whatsapp_credentials (business_id, access_token_enc) values ($1, $2)`, [CLINIC, encrypt("token-clinica")]);
});
afterEach(async () => db.close());

function payload(messages: Record<string, unknown>[], phoneNumberId = PHONE_ID) {
  return { object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, messages } }] }] };
}
const ts = (d: Date) => String(Math.floor(d.getTime() / 1000));
const text = (id: string, body: string, from = "34600111222") => ({ id, from, type: "text", text: { body }, timestamp: ts(NOW) });

function sender() {
  const sent: { to: string; text: string; token: string }[] = [];
  const s: WhatsAppSender = { send: async (m) => void sent.push({ to: m.to, text: m.text, token: m.token }) };
  return { s, sent };
}

/** Motor falso: ejecuta las herramientas que diga cada prueba y responde con su resultado. */
type Step = { tool: string; args: Record<string, unknown> };
function engine(plan: (text: string) => Step[], results: Record<string, unknown>[] = []): ChatEngine {
  return async ({ messages, userText, exec }) => {
    const replies: string[] = [];
    for (const st of plan(userText)) {
      const out = await exec(st.tool, st.args);
      results.push(out);
      replies.push(`${st.tool}: ${out.ok ? "ok" : out.error}`);
    }
    if (!replies.length) replies.push(`eco: ${userText}`);
    return { messages: [...messages, { role: "user", content: userText }, { role: "assistant", content: replies.join(" | ") }], replies };
  };
}

async function receive(msgs: Record<string, unknown>[], e: ChatEngine, s: WhatsAppSender, now = NOW) {
  const d = { ...deps(db), now: () => now };
  const inbound = await takeInbound(d, payload(msgs));
  for (const m of inbound) await handleInbound(d, m, { engine: e, sender: s, secret: "test-secret", sleep: async () => {} });
  return inbound;
}

describe("WhatsApp: seguridad del webhook", () => {
  it("firma X-Hub-Signature-256 con el secreto de la app", () => {
    const body = JSON.stringify(payload([text("m1", "hola")]));
    expect(verifyMetaSignature(body, signMeta(body, "app-secret"), "app-secret")).toBe(true);
    expect(verifyMetaSignature(body, signMeta(body, "otro"), "app-secret")).toBe(false);
    expect(verifyMetaSignature(body + " ", signMeta(body, "app-secret"), "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, null, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, signMeta(body, "app-secret"), undefined)).toBe(false);
  });

  it("la firma se calcula sobre los bytes crudos (acentos y emojis incluidos)", () => {
    const raw = Buffer.from(JSON.stringify(payload([text("m1", "¿Mañana a las 10? 👍")])), "utf8");
    expect(verifyMetaSignature(raw, signMeta(raw, "app-secret"), "app-secret")).toBe(true);
    expect(verifyMetaSignature(raw, signMeta(raw.toString("latin1"), "app-secret"), "app-secret")).toBe(false);
  });

  it("verificación de la suscripción solo con el token correcto", () => {
    const ok = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "vt", "hub.challenge": "123" });
    expect(verifySubscription(ok, "vt")).toBe("123");
    expect(verifySubscription(ok, "otro")).toBeNull();
    expect(verifySubscription(ok, undefined)).toBeNull();
  });
});

describe("WhatsApp: mensajes", () => {
  it("responde al número que escribe, con el token del negocio, y queda en el historial", async () => {
    const { s, sent } = sender();
    await receive([text("m1", "hola")], engine(() => []), s);
    expect(sent).toEqual([{ to: "34600111222", text: "eco: hola", token: "token-clinica" }]);
    const call = await db.query<{ provider: string; caller_last4: string; ended_reason: string }>(
      `select c.provider, c.caller_last4, c.ended_reason from calls c join chat_sessions s on s.call_id = c.id where s.channel = 'whatsapp'`,
    );
    expect(call).toEqual([{ provider: "whatsapp", caller_last4: "1222", ended_reason: "whatsapp" }]);
  });

  it("un webhook repetido no se responde dos veces", async () => {
    const { s, sent } = sender();
    await receive([text("m1", "hola")], engine(() => []), s);
    const again = await receive([text("m1", "hola")], engine(() => []), s);
    expect(again).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it("número de otro negocio, desactivado o desconocido: se ignora", async () => {
    expect(await takeInbound(deps(db), payload([text("x1", "hola")], "999"))).toHaveLength(0);
    await db.query(`update businesses set whatsapp_enabled = false where id = $1`, [CLINIC]);
    expect(await takeInbound(deps(db), payload([text("x2", "hola")]))).toHaveLength(0);
    expect(await takeInbound(deps(db), { entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "s" }] } }] }] })).toHaveLength(0);
    expect(await takeInbound(deps(db), null)).toHaveLength(0);
  });

  it("mensajes seguidos del mismo número siguen la misma conversación", async () => {
    const { s } = sender();
    await receive([text("m1", "hola"), text("m2", "quería una cita")], engine(() => []), s);
    await receive([text("m3", "hola", "34600999888")], engine(() => []), s);
    const sessions = await db.query<{ turns: number }>(`select turns from chat_sessions where channel = 'whatsapp' order by turns desc`);
    expect(sessions.map((x) => x.turns)).toEqual([2, 1]);
  });

  it("un mensaje de hace más de 24 h (reintento tardío de Meta) no se contesta", async () => {
    const { s, sent } = sender();
    const old = { ...text("v1", "hola"), timestamp: ts(new Date(NOW.getTime() - 25 * 3600_000)) };
    expect(await receive([old], engine(() => []), s)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("audio o imagen: pide que lo escriba", async () => {
    const { s, sent } = sender();
    await receive([{ id: "a1", from: "34600111222", type: "audio", audio: { id: "media" } }], engine(() => []), s);
    expect(sent[0].text).toBe(WHATSAPP_TEXT.notText);
  });

  it("reserva con el número de WhatsApp (sin pedirlo) y luego la ve y la cancela sin código", async () => {
    const { s } = sender();
    const results: Record<string, unknown>[] = [];
    await receive([text("m1", "huecos")], engine(() => [{ tool: "buscar_huecos", args: { servicio: "revisión", dia: "el jueves 5 de noviembre" } }], results), s);
    const slot = (results[0].opciones as { inicio: string }[])[0].inicio;
    await receive([text("m2", "reserva")], engine(() => [{ tool: "reservar_cita", args: { servicio: "Revisión y diagnóstico", inicio: slot, nombre: "Ana Whats" } }], results), s);
    expect(results[1].ok).toBe(true);
    const appt = await db.query<{ phone: string }>(`select c.phone from appointments a join customers c on c.id = a.customer_id where c.name = 'Ana Whats'`);
    expect(appt[0].phone).toBe("+34600111222");

    await receive([text("m3", "mis citas")], engine(() => [{ tool: "buscar_mis_citas", args: {} }], results), s);
    expect(results[2].citas).toHaveLength(1);
    // Otro número no la ve aunque escriba ese teléfono, ni la cancela con el código sin el nombre
    const code = results[1].codigo as string;
    await receive([text("m4", "citas", "34600999888")], engine(() => [
      { tool: "buscar_mis_citas", args: { telefono: "600111222" } },
      { tool: "cancelar_cita", args: { cita: code } },
    ], results), s);
    expect(results[3].citas).toHaveLength(0);
    expect(results[4].error).toBe("verificacion_necesaria");
    // Desde su número la cancela con solo el código
    await receive([text("m5", "cancela")], engine(() => [{ tool: "cancelar_cita", args: { cita: code } }], results), s);
    expect(results[5].ok).toBe(true);
  });

  it("un fallo del agente se avisa por WhatsApp y queda para revisar", async () => {
    const { s, sent } = sender();
    const broken: ChatEngine = async () => {
      throw new Error("Claude caído");
    };
    await receive([text("m1", "hola")], broken, s);
    expect(sent[0].text).toBe(WHATSAPP_TEXT.failed);
    const issues = await db.query<{ message: string }>(`select message from issues where business_id = $1 and message like 'WhatsApp%'`, [CLINIC]);
    expect(issues[0].message).toMatch(/1222/);
    expect(issues[0].message).not.toMatch(/600111222/);
  });

  it("sin token (ni del negocio ni de la plataforma) no se envía nada", async () => {
    await db.query(`update businesses set whatsapp_enabled = true, whatsapp_phone_number_id = '555' where id = $1`, [GARAGE]);
    const { s, sent } = sender();
    const inbound: Inbound[] = await takeInbound(deps(db), payload([text("g1", "hola")], "555"));
    for (const m of inbound) await handleInbound(deps(db), m, { engine: engine(() => []), sender: s, secret: "x" });
    expect(inbound).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it("RGPD: el texto de la conversación se borra al terminar; el registro de la llamada queda", async () => {
    const { s } = sender();
    await receive([text("m1", "hola, soy Ana y quería una limpieza")], engine(() => []), s);
    await receive([text("o1", "hola", "34600999888")], engine(() => []), s, new Date(NOW.getTime() + 110 * 60_000));
    const content = async () =>
      db.query<{ ended: boolean; n: number; ip_hash: string }>(`select ended, jsonb_array_length(messages) n, ip_hash from chat_sessions where channel = 'whatsapp' order by created_at`);

    // A las 2 h sin mensajes se vacía la primera; la otra sigue abierta (y no se toca si está respondiendo)
    const later = new Date(NOW.getTime() + 121 * 60_000);
    expect(await purgeChatContent(db, later)).toBe(1);
    expect((await content()).map((x) => [x.ended, x.n])).toEqual([[true, 0], [false, 2]]);
    expect(JSON.stringify(await db.query(`select messages from chat_sessions`))).not.toMatch(/Ana/);
    expect(await db.query(`select id from calls where provider = 'whatsapp'`)).toHaveLength(2);

    // Si vuelve a escribir, empieza una conversación nueva, sin el texto de la anterior
    await receive([text("m2", "otra cosa")], engine(() => []), s, later);
    const rows = await content();
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ ended: false, n: 2, ip_hash: rows[0].ip_hash });
  });

  it("RGPD: al cerrar una conversación por inactividad se vacía en el momento", async () => {
    const { s } = sender();
    await receive([text("m1", "hola, soy Ana")], engine(() => []), s);
    await receive([text("m2", "sigo")], engine(() => []), s, new Date(NOW.getTime() + 3 * 3600_000));
    const rows = await db.query<{ ended: boolean; n: number }>(`select ended, jsonb_array_length(messages) n from chat_sessions order by created_at`);
    expect(rows.map((x) => [x.ended, x.n])).toEqual([[true, 0], [false, 2]]);
  });

  it("los ids de mensajes se guardan solo mientras Meta puede reintentar", async () => {
    const { s } = sender();
    await receive([text("m1", "hola")], engine(() => []), s);
    expect(await purgeWhatsAppInbound(db, new Date(NOW.getTime() + 2 * 24 * 3600_000))).toBe(0);
    expect(await purgeWhatsAppInbound(db, new Date(NOW.getTime() + 9 * 24 * 3600_000))).toBe(1);
  });

  it("el prompt de WhatsApp no pide el teléfono ni promete transferir", async () => {
    const business = (await getBusiness(db, CLINIC))!;
    const { stable, transferPossible } = await buildSystemPrompt(db, business, NOW, "whatsapp");
    expect(stable).toMatch(/WhatsApp del negocio/);
    expect(stable).toMatch(/El teléfono lo tienes de WhatsApp/);
    expect(stable).not.toMatch(/Pide también un teléfono/);
    expect(transferPossible).toBe(false);
  });
});
