/**
 * Prueba WhatsApp en local, sin Meta: simula la Graph API y te deja escribir como si fueras un cliente.
 * El agente es el de verdad (Claude, herramientas y agenda locales); solo Meta es de mentira.
 *
 *   1. En .env.local: ANTHROPIC_API_KEY, WHATSAPP_APP_SECRET y WHATSAPP_VERIFY_TOKEN (cualquier texto en local)
 *      y WHATSAPP_GRAPH_URL=http://127.0.0.1:4599
 *   2. npm run dev    y, en otra terminal:    npm run whatsapp:local
 *   3. Panel → Configuración → WhatsApp: identificador 100000000000001, token «local» → Comprobar y activar
 *   4. Escribe aquí. Las respuestas del asistente salen aquí mismo.
 *
 * Opcional: WHATSAPP_LOCAL_FROM (número del «cliente», por defecto 34600000001).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import readline from "node:readline";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.WHATSAPP_APP_SECRET;
const PHONE_ID = "100000000000001";
const FROM = process.env.WHATSAPP_LOCAL_FROM ?? "34600000001";
const PORT = 4599;

if (!SECRET) {
  console.error("Falta WHATSAPP_APP_SECRET en .env.local (el mismo que usa npm run dev).");
  process.exit(1);
}
// Firma webhooks con el secreto de la app: solo contra un servidor local.
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP_URL)) {
  console.error(`APP_URL=${APP_URL} no es local. Este script solo prueba contra npm run dev.`);
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "tú › " });
const say = (line: string) => {
  process.stdout.write(`\r\x1b[K${line}\n`);
  rl.prompt(true);
};

// Graph API simulada: comprobación del número al activarlo en el panel y envío de mensajes.
http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "GET") {
        res.end(JSON.stringify({ display_phone_number: "+34 600 000 000", id: PHONE_ID }));
        return;
      }
      const body = JSON.parse(raw || "{}") as { status?: string; type?: string; text?: { body?: string } };
      if (body.type === "text") say(`asistente › ${body.text?.body}`);
      res.end(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: `wamid.out.${crypto.randomUUID()}` }] }));
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`Graph API simulada en http://127.0.0.1:${PORT} · webhook ${APP_URL}/api/whatsapp/webhook · escribes como +${FROM}`);
    if (process.env.WHATSAPP_GRAPH_URL !== `http://127.0.0.1:${PORT}`) console.log(`Aviso: npm run dev necesita WHATSAPP_GRAPH_URL=http://127.0.0.1:${PORT}`);
    rl.prompt();
  });

rl.on("line", async (line) => {
  const text = line.trim();
  if (!text) return rl.prompt();
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-local", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "34600000000", phone_number_id: PHONE_ID },
      contacts: [{ profile: { name: "Prueba" }, wa_id: FROM }],
      messages: [{ from: FROM, id: `wamid.local.${crypto.randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
    } }] }],
  });
  const signature = `sha256=${crypto.createHmac("sha256", SECRET).update(body).digest("hex")}`;
  try {
    const r = await fetch(`${APP_URL}/api/whatsapp/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body });
    if (!r.ok) say(`(el webhook respondió ${r.status})`);
  } catch (err) {
    say(`(no se pudo llamar al webhook: ${(err as Error).message}. ¿Está npm run dev en marcha?)`);
  }
  rl.prompt();
});
rl.on("close", () => process.exit(0));
