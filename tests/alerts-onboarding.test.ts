import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import type { EmailMessage } from "@/server/notify";
import { getBusiness, createIssue } from "@/server/booking/repo";
import { dailyDigest, isAnthropicAccountError, isControlFlowError, platformAlert, requestErrorAlert } from "@/server/platform-alerts";
import { getOnboarding } from "@/server/onboarding";
import { CLINIC, GARAGE, NOW, freshDb } from "./helpers";

let db: Db;
let sent: EmailMessage[];
beforeEach(async () => {
  db = await freshDb();
  sent = [];
});
afterEach(async () => db.close());

const opts = (now = NOW) => ({ to: "alertas@volkra.test", now, send: async (m: EmailMessage) => void sent.push(m) });
const alert = { key: "error:/api/x:boom", subject: "Error en /api/x", text: "boom" };

describe("Alertas para Volkra", () => {
  it("como mucho una por tipo y hora; la siguiente cuenta las que se saltó", async () => {
    expect(await platformAlert(db, alert, opts())).toBe("sent");
    expect(await platformAlert(db, alert, opts(new Date(NOW.getTime() + 10 * 60_000)))).toBe("throttled");
    expect(await platformAlert(db, alert, opts(new Date(NOW.getTime() + 20 * 60_000)))).toBe("throttled");
    expect(await platformAlert(db, { ...alert, key: "otro", subject: "Otro" }, opts())).toBe("sent");
    expect(await platformAlert(db, alert, opts(new Date(NOW.getTime() + 61 * 60_000)))).toBe("sent");
    const repeated = sent.filter((m) => m.subject === "[Volkra] Error en /api/x");
    expect(repeated).toHaveLength(2);
    expect(repeated[1].text).toMatch(/Además, 2 avisos iguales/);
    expect(sent[0].to).toBe("alertas@volkra.test");
  });

  it("sin destinatario no se envía nada; un fallo al enviar no rompe nada", async () => {
    expect(await platformAlert(db, alert, { ...opts(), to: null })).toBe("disabled");
    expect(await platformAlert(db, alert, { ...opts(), send: async () => { throw new Error("Resend caído"); } })).toBe("failed");
  });

  it("errores de petición: se ignoran redirect y notFound; se reconoce el saldo agotado de Anthropic", () => {
    expect(isControlFlowError(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }))).toBe(true);
    expect(isControlFlowError(new Error("TypeError: x is undefined"))).toBe(false);
    const a = requestErrorAlert(new Error("x is undefined"), "POST /api/whatsapp/webhook?y=1", "/api/whatsapp/webhook", "route");
    expect(a.subject).toBe("Error en /api/whatsapp/webhook");
    expect(a.text).not.toContain("?y=1");
    expect(isAnthropicAccountError(new Error("400 Your credit balance is too low to access the Anthropic API"))).toBe(true);
    expect(isAnthropicAccountError(new Error("529 overloaded"))).toBe(false);
  });

  it("resumen diario: fallos de negocios reales de las últimas 24 h; sin fallos, nada", async () => {
    await db.query(`update businesses set is_demo = false where id = $1`, [CLINIC]);
    // Las incidencias de demo de la semilla son anteriores a NOW: no cuentan
    const ignored = await dailyDigest(db, new Date(Date.now() + 2 * 86400_000), { remindersFailed: 0 });
    expect(ignored).toBeNull();
    await createIssue(db, { businessId: CLINIC, kind: "tool_error", message: "WhatsApp: no se pudo responder" });
    await createIssue(db, { businessId: CLINIC, kind: "tool_error", message: "WhatsApp: no se pudo responder otra vez" });
    await createIssue(db, { businessId: GARAGE, kind: "tool_error", message: "Taller demo: no cuenta" });
    await createIssue(db, { businessId: CLINIC, kind: "callback_request", message: "Recado: no es un fallo" });
    const d = await dailyDigest(db, new Date(), { remindersFailed: 1 });
    expect(d?.text).toMatch(/Clínica Dental Alba: Errores del asistente × 2/);
    expect(d?.text).toMatch(/Recordatorios .* 1/);
    expect(d?.text).not.toMatch(/Taller/);
    expect(d?.text).not.toMatch(/Recado/);
  });
});

describe("Puesta en marcha", () => {
  it("se calcula de la configuración real y se completa al rellenarla", async () => {
    const steps = async () => getOnboarding(db, (await getBusiness(db, CLINIC))!);
    const done = async () => Object.fromEntries((await steps()).map((s) => [s.key, s.done]));
    await db.query(`update businesses set notify_email = null, address = '', web_chat_enabled = false, whatsapp_enabled = false, agent_phone_number = null, vapi_phone_number_id = null, elevenlabs_agent_id = null where id = $1`, [CLINIC]);
    await db.query(`delete from faqs where business_id = $1`, [CLINIC]);
    let d = await done();
    expect(d).toMatchObject({ datos: false, avisos: false, canal: false, preguntas: false, horario: true, servicios: true, equipo: true });

    await db.query(`update businesses set address = 'Calle Mayor 1', public_phone = '+34977000000', notify_email = 'r@c.test', web_chat_enabled = true where id = $1`, [CLINIC]);
    for (const n of [1, 2, 3]) await db.query(`insert into faqs (business_id, question, answer) values ($1, $2, 'Sí')`, [CLINIC, `Pregunta ${n}`]);
    d = await done();
    expect(d).toMatchObject({ datos: true, avisos: true, canal: true, preguntas: true });
    expect((await steps()).find((s) => s.key === "calendario")?.optional).toBe(true);
  });
});
