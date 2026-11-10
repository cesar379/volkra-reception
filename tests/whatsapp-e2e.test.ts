import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/client";
import { encrypt } from "@/server/crypto";
import { signMeta } from "@/server/whatsapp/handler";
import { CLINIC, NOW, deps, freshDb } from "./helpers";

/**
 * De punta a punta por HTTP: la ruta real del webhook, el SDK de Anthropic (contra una API de Claude
 * simulada), las herramientas reales sobre la base de datos y el envío por la Graph API (simulada).
 */
let db: Db;
const pending: (() => Promise<void>)[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => Promise<void>) => void pending.push(fn) }));
vi.mock("@/server/deps", () => ({ bookingDeps: async () => deps(db) }));

type Req = { path: string; auth: string | undefined; body: Record<string, unknown> };
const claudeReqs: Req[] = [];
const graphReqs: Req[] = [];
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const r: Req = { path: req.url ?? "", auth: req.headers.authorization ?? (req.headers["x-api-key"] as string), body: raw ? JSON.parse(raw) : {} };
      res.setHeader("content-type", "application/json");
      if (r.path === "/v1/messages") {
        claudeReqs.push(r);
        // 1.ª vuelta: Claude consulta la información del negocio; 2.ª: responde con texto.
        const first = claudeReqs.length % 2 === 1;
        const content = first
          ? [{ type: "tool_use", id: `tu_${claudeReqs.length}`, name: "consultar_informacion", input: { pregunta: "¿Hay aparcamiento?" } }]
          : [{ type: "text", text: "Sí, hay parking gratuito delante de la clínica." }];
        res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: r.body.model, content, stop_reason: first ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
        return;
      }
      graphReqs.push(r);
      res.end(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.out" }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    WHATSAPP_APP_SECRET: "app-secret",
    WHATSAPP_VERIFY_TOKEN: "verify-token",
    WHATSAPP_GRAPH_URL: base,
    ANTHROPIC_API_KEY: "sk-ant-test",
    ANTHROPIC_BASE_URL: base,
  });
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(async () => {
  db = await freshDb();
  await db.query(`update businesses set whatsapp_enabled = true, whatsapp_phone_number_id = '109876543210' where id = $1`, [CLINIC]);
  await db.query(`insert into whatsapp_credentials (business_id, access_token_enc) values ($1, $2)`, [CLINIC, encrypt("token-clinica")]);
  claudeReqs.length = graphReqs.length = pending.length = 0;
});
afterEach(async () => db.close());

const route = () => import("@/app/api/whatsapp/webhook/route");
function webhook(body: string, signature: string | null) {
  return new Request("http://localhost/api/whatsapp/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) },
    body,
  });
}
const message = (id: string, body: string) =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "109876543210" }, contacts: [{ wa_id: "34600111222" }], messages: [{ id, from: "34600111222", timestamp: String(Math.floor(NOW.getTime() / 1000)), type: "text", text: { body } }] } }] }],
  });

describe("WhatsApp de punta a punta", () => {
  it("GET: Meta verifica la suscripción con hub.verify_token", async () => {
    const { GET } = await route();
    const ok = await GET(new Request("http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=42"));
    expect([ok.status, await ok.text()]).toEqual([200, "42"]);
    const bad = await GET(new Request("http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=42"));
    expect(bad.status).toBe(403);
  });

  it("POST sin firma válida: 401 y no se procesa nada", async () => {
    const { POST } = await route();
    const body = message("wamid.1", "hola");
    expect((await POST(webhook(body, null))).status).toBe(401);
    expect((await POST(webhook(body, signMeta(body, "otro-secreto")))).status).toBe(401);
    expect(pending).toHaveLength(0);
    expect(await db.query(`select 1 from whatsapp_inbound`)).toHaveLength(0);
  });

  it("mensaje firmado → 200 → Claude con las 7 herramientas → herramienta real → respuesta por la Cloud API", async () => {
    const { POST } = await route();
    const body = message("wamid.1", "¿Tenéis aparcamiento?");
    const res = await POST(webhook(body, signMeta(body, "app-secret")));
    expect(res.status).toBe(200);
    expect(graphReqs).toHaveLength(0); // se contesta a Meta antes de llamar a Claude
    for (const fn of pending.splice(0)) await fn();

    // Claude: el modelo del negocio y las mismas herramientas de agenda que el teléfono, sin transferir ni colgar
    expect(claudeReqs).toHaveLength(2);
    const tools = (claudeReqs[0].body.tools as { name: string }[]).map((t) => t.name).sort();
    expect(tools).toEqual(["buscar_huecos", "buscar_mis_citas", "cambiar_cita", "cancelar_cita", "consultar_informacion", "dejar_recado", "reservar_cita"]);
    expect(JSON.stringify(claudeReqs[0].body.system)).toMatch(/WhatsApp/);
    expect(JSON.stringify(claudeReqs[1].body.messages)).toMatch(/tool_result/);

    // Meta: marcado como leído y la respuesta al número que escribió, con el token del negocio
    expect(graphReqs.map((r) => r.path)).toEqual(["/v23.0/109876543210/messages", "/v23.0/109876543210/messages"]);
    expect(graphReqs.every((r) => r.auth === "Bearer token-clinica")).toBe(true);
    expect(graphReqs[0].body).toMatchObject({ status: "read", message_id: "wamid.1" });
    expect(graphReqs[1].body).toMatchObject({ messaging_product: "whatsapp", to: "34600111222", type: "text", text: { body: "Sí, hay parking gratuito delante de la clínica." } });

    // Queda en Llamadas como WhatsApp, con la herramienta registrada
    const call = await db.query<{ provider: string; caller_last4: string; n: number }>(
      `select c.provider, c.caller_last4, (select count(*)::int from call_events e where e.call_id = c.id) n from calls c where c.provider = 'whatsapp'`,
    );
    expect(call).toMatchObject([{ provider: "whatsapp", caller_last4: "1222" }]);
    expect(call[0].n).toBeGreaterThan(0);

    // Meta reintenta el mismo webhook: no se vuelve a contestar
    const again = await POST(webhook(body, signMeta(body, "app-secret")));
    expect(again.status).toBe(200);
    expect(pending).toHaveLength(0);
  });
});
