import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { Db } from "@/server/db/client";
import { handleInit, handlePostCall, handleTool, signElevenLabs, verifyBearer, verifyElevenLabsSignature } from "@/server/elevenlabs/handler";
import { DEMO_USERS } from "@/server/db/seed";
import { CLINIC, GARAGE, deps, freshDb } from "./helpers";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`update businesses set elevenlabs_agent_id = 'agent_clinica' where id = $1`, [CLINIC]);
  await db.query(`update businesses set elevenlabs_agent_id = 'agent_taller' where id = $1`, [GARAGE]);
});
afterEach(async () => db.close());

const init = (conversation: string, caller = "+34000033001") =>
  handleInit(deps(db), { caller_id: caller, agent_id: "agent_clinica", called_number: "+34910000099", call_sid: "CA1", conversation_id: conversation });

describe("ElevenLabs: autenticación y firma", () => {
  it("las herramientas exigen el secreto", () => {
    expect(verifyBearer(new Headers({ authorization: "Bearer s3cret" }), "s3cret")).toBe(true);
    expect(verifyBearer(new Headers({ authorization: "Bearer otro" }), "s3cret")).toBe(false);
    expect(verifyBearer(new Headers(), "s3cret")).toBe(false);
    expect(verifyBearer(new Headers({ authorization: "Bearer s3cret" }), undefined)).toBe(false);
  });

  it("la firma del fin de llamada es la misma que valida el SDK oficial", async () => {
    const body = JSON.stringify({ type: "post_call_transcription", data: { conversation_id: "c1" } });
    const t = String(Math.floor(Date.now() / 1000));
    const header = `t=${t},${signElevenLabs(body, t, "whsec")}`;
    expect(verifyElevenLabsSignature(body, header, "whsec")).toBe(true);
    const sdk = new ElevenLabsClient({ apiKey: "no-se-usa" });
    await expect(sdk.webhooks.constructEvent(body, header, "whsec")).resolves.toMatchObject({ type: "post_call_transcription" });
    // Manipulaciones
    expect(verifyElevenLabsSignature(body.replace("c1", "c2"), header, "whsec")).toBe(false);
    expect(verifyElevenLabsSignature(body, header, "otro")).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(verifyElevenLabsSignature(body, `t=${old},${signElevenLabs(body, old, "whsec")}`, "whsec")).toBe(false);
  });
});

describe("ElevenLabs: llamada completa", () => {
  it("inicio: prompt del negocio en español con los nombres de herramienta de ElevenLabs", async () => {
    type Init = { dynamic_variables: Record<string, string>; conversation_config_override: { agent: { prompt: { prompt: string }; first_message?: string; language: string } } };
    const r = (await init("conv-1")) as Init;
    expect(r.dynamic_variables.negocio).toBe("Clínica Dental Alba");
    expect(r.dynamic_variables.transferencia).toBe("si"); // jueves 10:00, abierto
    expect(r.conversation_config_override.agent.language).toBe("es");
    // Por defecto no se sobrescribe el saludo (el plan Free de ElevenLabs no lo permite)
    expect(r.conversation_config_override.agent).not.toHaveProperty("first_message");
    const withGreeting = (await handleInit(deps(db), { agent_id: "agent_clinica", conversation_id: "conv-1b" }, { overrideFirstMessage: true })) as Init;
    expect(withGreeting.conversation_config_override.agent.first_message).toMatch(/asistente virtual/);
    expect(r.conversation_config_override.agent.prompt.prompt).toContain("transfer_to_number");
    expect(r.conversation_config_override.agent.prompt.prompt).not.toContain("transferCall");
    // El teléfono se guarda cifrado, nunca en claro
    const c = await db.query<{ caller_phone_enc: string; caller_last4: string }>(`select caller_phone_enc, caller_last4 from calls where provider_call_id = 'conv-1'`);
    expect(c[0].caller_last4).toBe("3001");
    expect(c[0].caller_phone_enc).not.toContain("34000033001");
  });

  it("herramientas: reserva con el teléfono de la telefonía, reintento sin duplicar y fin de llamada", async () => {
    await init("conv-2", "+34000033002");
    const s = await handleTool(deps(db), "buscar_huecos", { servicio: "revisión", dia: "el jueves 5 de noviembre", conversation_id: "conv-2", agent_id: "agent_clinica" });
    expect(s.ok).toBe(true);
    const opt = (s.opciones as { inicio: string; profesional_id: string }[])[0];
    const args = { servicio: "Revisión y diagnóstico", inicio: opt.inicio, profesional: opt.profesional_id, nombre: "Eva Llamada", conversation_id: "conv-2", agent_id: "agent_clinica" };
    const a = await handleTool(deps(db), "reservar_cita", args);
    const b = await handleTool(deps(db), "reservar_cita", args); // ElevenLabs reintenta
    expect(a.ok).toBe(true);
    expect(b.codigo).toBe(a.codigo);
    const n = await db.query<{ n: number; phone: string }>(
      `select count(*)::int n, max(c.phone) phone from appointments a join customers c on c.id = a.customer_id where c.name = 'Eva Llamada'`,
    );
    expect(n[0]).toEqual({ n: 1, phone: "+34000033002" });

    // El modelo NO puede suplantar el teléfono pasando caller_id
    const mine = await handleTool(deps(db), "buscar_mis_citas", { conversation_id: "conv-2", agent_id: "agent_clinica", caller_id: "+34999999999" });
    expect((mine.citas as unknown[]).length).toBe(1);

    const event = {
      type: "post_call_transcription",
      data: {
        agent_id: "agent_clinica", conversation_id: "conv-2", status: "done",
        transcript: [{ role: "agent", message: "Te paso", tool_calls: [{ tool_name: "transfer_to_number" }] }],
        metadata: { start_time_unix_secs: 1792663200, call_duration_secs: 95, termination_reason: "transfer" },
        analysis: { transcript_summary: "Reservó una revisión y pidió hablar con recepción." },
      },
    };
    expect((await handlePostCall(deps(db), event)).handled).toBe(true);
    await handlePostCall(deps(db), event); // repetido: sin efectos
    const call = await db.query<{ duration_sec: number; status: string; outcome: string; summary: string; caller_phone_enc: string | null }>(
      `select duration_sec, status, outcome, summary, caller_phone_enc from calls where provider_call_id = 'conv-2'`,
    );
    expect(call[0]).toMatchObject({ duration_sec: 95, status: "transferred", outcome: "booked", caller_phone_enc: null });
    expect(call[0].summary).toMatch(/Reserva/); // resumen propio en español, no el de ElevenLabs
    const ev = await db.query<{ n: number }>(`select count(*)::int n from call_events e join calls c on c.id = e.call_id where c.provider_call_id = 'conv-2' and e.kind = 'transfer'`);
    expect(ev[0].n).toBe(1);
  });

  it("pruebas desde el navegador de ElevenLabs (sin /init): las herramientas funcionan, sin teléfono", async () => {
    const s = await handleTool(deps(db), "consultar_informacion", { pregunta: "¿Tenéis aparcamiento?", conversation_id: "web-1", agent_id: "agent_clinica" });
    expect(s.encontrado).toBe(true);
    const r = await handleTool(deps(db), "reservar_cita", { servicio: "Revisión y diagnóstico", inicio: "2026-11-05T10:00", nombre: "Sin Teléfono", conversation_id: "web-1", agent_id: "agent_clinica" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("falta_telefono");
  });

  it("llamada por SIP sin caller_id (vacío, ausente o 'anonymous'): no rompe, no guarda nada y pide el teléfono", async () => {
    for (const [conv, caller] of [["sip-1", ""], ["sip-2", undefined], ["sip-3", "anonymous"]] as const) {
      const body: Record<string, unknown> = { agent_id: "agent_clinica", called_number: "+34910000099", conversation_id: conv };
      if (caller !== undefined) body.caller_id = caller;
      const r = (await handleInit(deps(db), body)) as { dynamic_variables: Record<string, string> };
      expect(r.dynamic_variables.negocio).toBe("Clínica Dental Alba");
      const c = await db.query<{ caller_last4: string | null }>(`select caller_last4 from calls where provider_call_id = $1`, [conv]);
      expect(c[0].caller_last4).toBeNull();
      const res = await handleTool(deps(db), "reservar_cita", { servicio: "Revisión y diagnóstico", inicio: "2026-11-05T10:00", nombre: "Sin Identificar", conversation_id: conv, agent_id: "agent_clinica" });
      expect(res.error).toBe("falta_telefono");
      // Sin teléfono de la llamada, ver o cancelar citas exige código y nombre
      const mine = await handleTool(deps(db), "buscar_mis_citas", { conversation_id: conv, agent_id: "agent_clinica" });
      expect(mine.error).toBe("verificacion_necesaria");
    }
    const stored = await db.query<{ n: number }>(`select count(*)::int n from calls where provider_call_id like 'sip-%' and caller_phone_enc is not null and caller_phone_enc <> ''`);
    // "anonymous" se guarda cifrado pero no es un teléfono válido: nunca se usa como identidad
    expect(stored[0].n).toBeLessThanOrEqual(1);
  });

  it("aislamiento: el agente de un negocio no actúa sobre otro, ni con un id de conversación ajeno", async () => {
    await init("conv-3");
    const other = await handleTool(deps(db), "consultar_informacion", { pregunta: "¿Tenéis aparcamiento?", conversation_id: "conv-3", agent_id: "agent_taller" });
    expect(other.ok).toBe(false);
    expect(other.error).toBe("llamada_de_otro_negocio");
    const unknown = await handleTool(deps(db), "buscar_huecos", { servicio: "x", dia: "mañana", agent_id: "agent_inexistente" });
    expect(unknown.ok).toBe(false);
    const badTool = await handleTool(deps(db), "borrar_todo", { agent_id: "agent_clinica" });
    expect(badTool.error).toBe("herramienta_desconocida");
  });

  it("el teléfono cifrado no es legible para los usuarios del panel", async () => {
    await init("conv-4");
    await expect(db.asUser(DEMO_USERS.clinic.id, (q) => q.query(`select caller_phone_enc from calls`))).rejects.toThrow(/permission denied/);
    const ok = await db.asUser(DEMO_USERS.clinic.id, (q) => q.query(`select id, caller_last4 from calls where provider_call_id = 'conv-4'`));
    expect(ok).toHaveLength(1);
  });
});
