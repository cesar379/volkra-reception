/**
 * Conecta un número de Vapi con este servidor y con un negocio.
 * - Configura el número para que, en cada llamada, Vapi pida el asistente a nuestro servidor (assistant-request).
 * - Guarda el id y el número en el negocio, para saber qué negocio atiende cada llamada.
 *
 * Uso:
 *   VAPI_API_KEY=... VAPI_WEBHOOK_SECRET=... APP_URL=https://recepcion.volkra.es DATABASE_URL=... \
 *   npm run vapi:connect -- <id-del-numero-en-vapi> <id-del-negocio>
 */
import { createDb } from "../src/server/db/client";

async function main() {
  const [phoneNumberId, businessId] = process.argv.slice(2);
  const { VAPI_API_KEY, VAPI_WEBHOOK_SECRET, APP_URL, DATABASE_URL } = process.env;
  if (!phoneNumberId || !businessId || !VAPI_API_KEY || !VAPI_WEBHOOK_SECRET || !APP_URL) {
    console.error("Uso: VAPI_API_KEY=... VAPI_WEBHOOK_SECRET=... APP_URL=... DATABASE_URL=... npm run vapi:connect -- <phoneNumberId> <businessId>");
    process.exit(1);
  }
  const headers = { authorization: `Bearer ${VAPI_API_KEY}`, "content-type": "application/json" };
  const current = await fetch(`https://api.vapi.ai/phone-number/${phoneNumberId}`, { headers });
  if (!current.ok) throw new Error(`Vapi no encuentra el número (${current.status}): ${await current.text()}`);
  const phone = (await current.json()) as { number?: string; provider?: string };

  const res = await fetch(`https://api.vapi.ai/phone-number/${phoneNumberId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      assistantId: null, // sin asistente fijo: Vapi pedirá la configuración a nuestro servidor en cada llamada
      server: {
        url: `${APP_URL.replace(/\/$/, "")}/api/vapi/webhook`,
        headers: { Authorization: `Bearer ${VAPI_WEBHOOK_SECRET}` },
        timeoutSeconds: 15,
      },
    }),
  });
  if (!res.ok) throw new Error(`Vapi rechazó la actualización (${res.status}): ${await res.text()}`);
  console.log(`Número ${phone.number ?? phoneNumberId} (${phone.provider ?? "?"}) apunta a ${APP_URL}/api/vapi/webhook`);

  if (DATABASE_URL) {
    const db = await createDb({ databaseUrl: DATABASE_URL });
    try {
      const r = await db.query(
        `update businesses set vapi_phone_number_id = $2, agent_phone_number = coalesce($3, agent_phone_number) where id = $1 returning name`,
        [businessId, phoneNumberId, phone.number ?? null],
      );
      if (!r.length) throw new Error("No existe ese negocio");
      console.log(`Asignado al negocio «${(r[0] as { name: string }).name}».`);
    } finally {
      await db.close();
    }
  } else {
    console.log("Sin DATABASE_URL: asigna el número al negocio desde Configuración → Asistente de voz.");
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
