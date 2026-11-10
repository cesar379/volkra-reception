import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { issueEmailAlert, type EmailMessage } from "@/server/notify";
import { handleVapiMessage } from "@/server/vapi/handler";
import { handleInit, handlePostCall } from "@/server/elevenlabs/handler";
import { sendSimulation, startSimulation } from "@/server/simulator/session";
import type { BookingDeps } from "@/server/booking/service";
import { CLINIC, NOW, freshDb, madrid } from "./helpers";

let db: Db;
let sent: EmailMessage[];
let failSend: boolean;

const alertDeps = (now = NOW): BookingDeps => ({
  db,
  now: () => now,
  alert: issueEmailAlert({
    enabled: () => true,
    appUrl: () => "https://recepcion.volkra.es",
    send: async (m) => {
      if (failSend) throw new Error("Resend respondió 500");
      sent.push(m);
    },
  }),
});

const recado = (deps: BookingDeps, callId: string, caller = "+34000088001") =>
  handleVapiMessage({ ...deps, appUrl: "https://x", webhookSecret: "s" }, {
    message: {
      type: "tool-calls",
      call: { id: callId, phoneNumberId: "pn_clinic", customer: { number: caller } },
      phoneNumber: { id: "pn_clinic" },
      toolCallList: [{ id: `t-${callId}`, type: "function", function: { name: "dejar_recado", arguments: { nombre: "Laura Ruiz", motivo: "Quiere presupuesto de ortodoncia" } } }],
    },
  }) as Promise<{ results: { result: string }[] }>;

beforeEach(async () => {
  db = await freshDb();
  sent = [];
  failSend = false;
  await db.query(`update businesses set vapi_phone_number_id = 'pn_clinic', elevenlabs_agent_id = 'agent_clinica' where id = $1`, [CLINIC]);
});
afterEach(async () => db.close());

describe("avisos por email al negocio", () => {
  it("con email de avisos: cada recado llega con nombre, teléfono, motivo, hora de Madrid y enlace al panel", async () => {
    await db.query(`update businesses set notify_email = 'recepcion@clinica.test' where id = $1`, [CLINIC]);
    const r = await recado(alertDeps(), "a1");
    expect(JSON.parse(r.results[0].result).ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("recepcion@clinica.test");
    expect(sent[0].subject).toBe("Recado de Laura Ruiz – Clínica Dental Alba");
    expect(sent[0].text).toContain("+34000088001");
    expect(sent[0].text).toContain("presupuesto de ortodoncia");
    expect(sent[0].text).toMatch(/jueves 22 de octubre, 10:00 \(hora de Madrid\)/);
    expect(sent[0].text).toContain("https://recepcion.volkra.es/incidencias");
  });

  it("sin email de avisos no se envía nada (el recado sigue en el panel)", async () => {
    await recado(alertDeps(), "a2");
    expect(sent).toHaveLength(0);
    const issues = await db.query<{ n: number }>(`select count(*)::int n from issues where kind = 'callback_request' and message like '%Laura Ruiz%'`);
    expect(issues[0].n).toBe(1);
  });

  it("si Resend falla, el recado se guarda y el asistente lo confirma igual", async () => {
    await db.query(`update businesses set notify_email = 'recepcion@clinica.test' where id = $1`, [CLINIC]);
    failSend = true;
    const r = await recado(alertDeps(), "a3");
    const out = JSON.parse(r.results[0].result);
    expect(out.ok).toBe(true);
    expect(out.recado_guardado).toBe(true);
    const issues = await db.query<{ n: number }>(`select count(*)::int n from issues where kind = 'callback_request' and message like '%Laura Ruiz%'`);
    expect(issues[0].n).toBe(1);
  });

  it("los recados del simulador no envían emails", async () => {
    await db.query(`update businesses set notify_email = 'recepcion@clinica.test' where id = $1`, [CLINIC]);
    const d = alertDeps(madrid("2026-10-25", "21:00")); // domingo: no se puede transferir → recado
    const s = await startSimulation(d, CLINIC, {});
    for (const t of ["Quiero hablar con alguien", "Presupuesto de un implante", "Pedro Ruiz"]) await sendSimulation(d, CLINIC, s.sessionId, t, {});
    const issues = await db.query<{ n: number }>(`select count(*)::int n from issues where kind = 'callback_request' and message like '%Pedro Ruiz%'`);
    expect(issues[0].n).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("llamada fallida (Vapi): aviso con el teléfono para devolverla", async () => {
    await db.query(`update businesses set notify_email = 'recepcion@clinica.test' where id = $1`, [CLINIC]);
    await handleVapiMessage({ ...alertDeps(), appUrl: "https://x", webhookSecret: "s" }, {
      message: {
        type: "end-of-call-report", call: { id: "f1", phoneNumberId: "pn_clinic", customer: { number: "+34000088002" } }, phoneNumber: { id: "pn_clinic" },
        endedReason: "pipeline-error-anthropic-llm-failed", startedAt: "2026-10-22T08:00:00Z", endedAt: "2026-10-22T08:00:40Z",
      },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Llamada fallida – Clínica Dental Alba");
    expect(sent[0].text).toContain("+34000088002");
  });

  it("llamada fallida (ElevenLabs): aviso con el teléfono, que después se borra", async () => {
    await db.query(`update businesses set notify_email = 'recepcion@clinica.test' where id = $1`, [CLINIC]);
    await handleInit(alertDeps(), { caller_id: "+34000088003", agent_id: "agent_clinica", conversation_id: "f2" });
    await handlePostCall(alertDeps(), { type: "post_call_transcription", data: { agent_id: "agent_clinica", conversation_id: "f2", status: "failed", metadata: { call_duration_secs: 12, termination_reason: "error" } } });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("+34000088003");
    const c = await db.query<{ caller_phone_enc: string | null }>(`select caller_phone_enc from calls where provider_call_id = 'f2'`);
    expect(c[0].caller_phone_enc).toBeNull();
  });

  it("la base de datos rechaza un email de avisos mal formado", async () => {
    await expect(db.query(`update businesses set notify_email = 'no-es-un-email' where id = $1`, [CLINIC])).rejects.toThrow(/check/i);
  });
});
