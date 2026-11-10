import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { handleVapiMessage, verifyVapiRequest, type VapiDeps } from "@/server/vapi/handler";
import { bookAppointment } from "@/server/booking/service";
import { DEMO_USERS } from "@/server/db/seed";
import { CLINIC, GARAGE, NOW, SVC, freshDb, madrid } from "./helpers";

const SECRET = "test-secret-123";
let db: Db;
let now = NOW;

const vdeps = (): VapiDeps => ({ db, now: () => now, appUrl: "https://app.example.com", webhookSecret: SECRET });
const call = (id: string, caller = "+34000077001") => ({ id, phoneNumberId: "pn_clinic", customer: { number: caller } });
const toolCall = (callId: string, tcId: string, name: string, args: Record<string, unknown>, caller?: string) =>
  handleVapiMessage(vdeps(), {
    message: { type: "tool-calls", call: call(callId, caller), phoneNumber: { id: "pn_clinic" }, toolCallList: [{ id: tcId, type: "function", function: { name, arguments: args } }] },
  }) as Promise<{ results: { toolCallId: string; result?: string; error?: string }[] }>;
const parse = (r: { results: { result?: string }[] }) => JSON.parse(r.results[0].result!);

beforeEach(async () => {
  now = NOW;
  db = await freshDb();
  await db.query(`update businesses set vapi_phone_number_id = 'pn_clinic', agent_phone_number = '+34910000099' where id = $1`, [CLINIC]);
  await db.query(`update businesses set vapi_phone_number_id = 'pn_garage' where id = $1`, [GARAGE]);
});
afterEach(async () => db.close());

describe("seguridad del webhook", () => {
  it("solo acepta peticiones con el secreto correcto", () => {
    expect(verifyVapiRequest(new Headers(), SECRET)).toBe(false);
    expect(verifyVapiRequest(new Headers({ authorization: "Bearer otro" }), SECRET)).toBe(false);
    expect(verifyVapiRequest(new Headers({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe(true);
    expect(verifyVapiRequest(new Headers({ "x-vapi-secret": SECRET }), SECRET)).toBe(true);
    expect(verifyVapiRequest(new Headers({ authorization: `Bearer ${SECRET}` }), undefined)).toBe(false); // sin configurar → nada entra
  });
});

describe("asistente de voz", () => {
  it("genera el asistente del negocio según el número llamado, todo con Claude y en español", async () => {
    const r = (await handleVapiMessage(vdeps(), { message: { type: "assistant-request", call: call("c1"), phoneNumber: { id: "pn_clinic" } } })) as {
      assistant: { model: { provider: string; model: string; tools: { type: string; messages?: { content: string }[]; server?: { headers: Record<string, string> } }[]; messages: { content: string }[] }; transcriber: { language: string }; firstMessage: string; artifactPlan: { recordingEnabled: boolean } };
    };
    expect(r.assistant.model.provider).toBe("anthropic");
    expect(r.assistant.model.model).toMatch(/^claude-/);
    expect(r.assistant.transcriber.language).toBe("es");
    expect(r.assistant.firstMessage).toMatch(/asistente virtual/);
    expect(r.assistant.artifactPlan.recordingEnabled).toBe(false);
    const fn = r.assistant.model.tools.filter((t) => t.type === "function");
    expect(fn.length).toBe(7);
    for (const t of fn) {
      // mensajes de espera propios en español (los de Vapi por defecto son en inglés)
      expect(t.messages?.[0].content.length).toBeGreaterThan(5);
      expect(t.messages?.[0].content).not.toMatch(/hold on|one moment|just a sec|give me a moment/i);
      expect(t.server?.headers.Authorization).toBe(`Bearer ${SECRET}`);
    }
    expect(r.assistant.model.tools.some((t) => t.type === "transferCall")).toBe(true);
    expect(r.assistant.model.messages[0].content).toContain("Limpieza dental");
    const calls = await db.query(`select 1 from calls where provider_call_id = 'c1'`);
    expect(calls).toHaveLength(1);
  });

  it("número desconocido: no inventa un negocio", async () => {
    const r = await handleVapiMessage(vdeps(), { message: { type: "assistant-request", call: { id: "x", phoneNumberId: "pn_nadie" }, phoneNumber: { id: "pn_nadie" } } });
    expect(r).toHaveProperty("error");
  });
});

describe("herramientas por webhook", () => {
  it("flujo completo: busca huecos reales y reserva", async () => {
    const s = parse(await toolCall("c2", "t1", "buscar_huecos", { servicio: "limpieza", dia: "el jueves 5 de noviembre", franja: "por la mañana" }));
    expect(s.ok).toBe(true);
    expect(s.opciones.length).toBeGreaterThan(0);
    expect(s.opciones.length).toBeLessThanOrEqual(3);
    const opt = s.opciones[0];
    const b = parse(await toolCall("c2", "t2", "reservar_cita", { servicio: "Limpieza dental", inicio: opt.inicio, profesional: opt.profesional_id, nombre: "Marta López" }));
    expect(b.ok).toBe(true);
    expect(b.codigo).toMatch(/^[A-Z2-9]{6}$/);
    const c = await db.query<{ outcome: string }>(`select outcome from calls where provider_call_id = 'c2'`);
    expect(c[0].outcome).toBe("booked");
    // los registros de la llamada no guardan el teléfono
    const ev = await db.query<{ detail: unknown }>(`select detail from call_events`);
    expect(JSON.stringify(ev)).not.toContain("+34000077001");
  });

  it("webhook repetido: misma respuesta y una sola cita", async () => {
    const args = { servicio: "Revisión y diagnóstico", inicio: "2026-11-05T17:00", nombre: "Repe Tido" };
    const a = await toolCall("c3", "dup-1", "reservar_cita", args);
    const b = await toolCall("c3", "dup-1", "reservar_cita", args);
    expect(a.results[0].result).toBe(b.results[0].result);
    const n = await db.query<{ n: number }>(`select count(*)::int n from appointments a join customers c on c.id = a.customer_id where c.name = 'Repe Tido'`);
    expect(n[0].n).toBe(1);
  });

  it("nunca confirma una hora que no está libre", async () => {
    const r = parse(await toolCall("c4", "t1", "reservar_cita", { servicio: "Limpieza dental", inicio: "2026-11-08T11:00", nombre: "Domingo Cerrado" }));
    expect(r.ok).toBe(false);
    expect(r.instruccion).toMatch(/No confirmes/);
  });

  it("información que la IA desconoce: lo dice, no inventa, y queda para revisar", async () => {
    const known = parse(await toolCall("c5", "t1", "consultar_informacion", { pregunta: "¿Tenéis aparcamiento?" }));
    expect(known.encontrado).toBe(true);
    expect(known.respuesta).toMatch(/parking/);
    const unknown = parse(await toolCall("c5", "t2", "consultar_informacion", { pregunta: "¿Hacéis carillas de porcelana?" }));
    expect(unknown.encontrado).toBe(false);
    expect(unknown.instruccion).toMatch(/no inventes/i);
    const issues = await db.query<{ n: number }>(`select count(*)::int n from issues where kind = 'unknown_question' and message like '%carillas%'`);
    expect(issues[0].n).toBe(1);
  });

  it("transferencia a humano: en horario transfiere; fuera de horario no, y se ofrece recado", async () => {
    const open = (await handleVapiMessage(vdeps(), { message: { type: "transfer-destination-request", call: call("c6"), phoneNumber: { id: "pn_clinic" } } })) as { destination?: { number: string } };
    expect(open.destination?.number).toBe("+34910000001");
    const c = await db.query<{ outcome: string }>(`select outcome from calls where provider_call_id = 'c6'`);
    expect(c[0].outcome).toBe("transferred");

    now = madrid("2026-10-25", "11:00"); // domingo
    const closed = (await handleVapiMessage(vdeps(), { message: { type: "transfer-destination-request", call: call("c7"), phoneNumber: { id: "pn_clinic" } } })) as { destination?: unknown; error?: string };
    expect(closed.destination).toBeUndefined();
    expect(closed.error).toMatch(/recado/);
    const msg = parse(await toolCall("c7", "t1", "dejar_recado", { nombre: "Laura", motivo: "Quiere un presupuesto de ortodoncia" }));
    expect(msg.ok).toBe(true);
    const issue = await db.query<{ n: number }>(`select count(*)::int n from issues where kind = 'callback_request' and message like '%Laura%'`);
    expect(issue[0].n).toBe(1);
  });

  it("fin de llamada: guarda duración, resultado y resumen una sola vez", async () => {
    await toolCall("c8", "t1", "consultar_informacion", { pregunta: "¿Cómo se puede pagar?" });
    const report = { message: { type: "end-of-call-report", call: call("c8"), phoneNumber: { id: "pn_clinic" }, endedReason: "customer-ended-call", startedAt: "2026-10-22T08:00:00Z", endedAt: "2026-10-22T08:02:05Z" } };
    await handleVapiMessage(vdeps(), report);
    await handleVapiMessage(vdeps(), report);
    const c = await db.query<{ duration_sec: number; status: string; outcome: string; summary: string }>(`select duration_sec, status, outcome, summary from calls where provider_call_id = 'c8'`);
    expect(c[0]).toMatchObject({ duration_sec: 125, status: "completed", outcome: "info" });
    expect(c[0].summary).toMatch(/información/);
  });
});

describe("identidad al cambiar o cancelar", () => {
  async function book(phone: string) {
    const r = await bookAppointment({ db, now: () => NOW }, {
      businessId: CLINIC, serviceId: SVC.revision, start: madrid("2026-11-05", "10:00"), customer: { name: "Carmen Vidal", phone }, source: "ai_call",
    });
    if (!r.ok) throw new Error("setup");
    return r.appointment.booking_code;
  }

  it("desde otro teléfono hace falta el código y el nombre", async () => {
    const code = await book("+34000066001");
    const denied = parse(await toolCall("c9", "t1", "cancelar_cita", { cita: code }, "+34000066999"));
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe("verificacion_necesaria");
    const wrongName = parse(await toolCall("c9", "t2", "cancelar_cita", { cita: code, nombre: "Pedro" }, "+34000066999"));
    expect(wrongName.ok).toBe(false);
    const ok = parse(await toolCall("c9", "t3", "cancelar_cita", { cita: code, nombre: "Carmen" }, "+34000066999"));
    expect(ok.ok).toBe(true);
  });

  it("desde el mismo teléfono basta con identificar la cita, y se puede cambiar", async () => {
    const code = await book("+34000066002");
    const mine = parse(await toolCall("c10", "t1", "buscar_mis_citas", {}, "+34000066002"));
    expect(mine.citas[0].codigo).toBe(code);
    const moved = parse(await toolCall("c10", "t2", "cambiar_cita", { cita: code, nuevo_inicio: "2026-11-05T12:00" }, "+34000066002"));
    expect(moved.ok).toBe(true);
    expect(moved.cuando).toMatch(/doce/);
  });
});

describe("aislamiento entre empresas", () => {
  it("una llamada a la clínica no puede tocar citas del taller", async () => {
    const g = await bookAppointment({ db, now: () => NOW }, {
      businessId: GARAGE, serviceId: SVC.aceite, start: madrid("2026-11-05", "09:00"), customer: { name: "Cliente Taller", phone: "+34000055001" }, source: "manual",
    });
    if (!g.ok) throw new Error("setup");
    const r = parse(await toolCall("c11", "t1", "cancelar_cita", { cita: g.appointment.booking_code, nombre: "Cliente" }, "+34000055001"));
    expect(r.ok).toBe(false);
    const still = await db.query<{ status: string }>(`select status from appointments where id = $1`, [g.appointment.id]);
    expect(still[0].status).toBe("confirmed");
  });

  it("RLS: un usuario solo ve y modifica datos de su empresa", async () => {
    const asClinic = await db.asUser(DEMO_USERS.clinic.id, async (q) => ({
      businesses: await q.query<{ id: string }>(`select id from businesses`),
      garageAppts: await q.query(`select id from appointments where business_id = $1`, [GARAGE]),
      garageCalls: await q.query(`select id from calls where business_id = $1`, [GARAGE]),
      ownServices: await q.query(`select id from services`),
    }));
    expect(asClinic.businesses.map((b) => b.id)).toEqual([CLINIC]);
    expect(asClinic.garageAppts).toHaveLength(0);
    expect(asClinic.garageCalls).toHaveLength(0);
    expect(asClinic.ownServices.length).toBeGreaterThan(0);

    // Escribir en otra empresa falla
    await expect(
      db.asUser(DEMO_USERS.garage.id, (q) => q.query(`insert into faqs (business_id, question, answer) values ($1, 'x', 'y')`, [CLINIC])),
    ).rejects.toThrow(/row-level security/);
    const upd = await db.asUser(DEMO_USERS.garage.id, (q) => q.query(`update businesses set name = 'Hackeado' where id = $1 returning id`, [CLINIC]));
    expect(upd).toHaveLength(0);
    // Tablas internas inaccesibles desde un usuario
    await expect(db.asUser(DEMO_USERS.clinic.id, (q) => q.query(`select * from google_credentials`))).rejects.toThrow(/permission denied/);
  });

  it("un usuario sin empresa no ve nada", async () => {
    await db.query(`insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'nuevo@x.com')`);
    const r = await db.asUser("33333333-3333-4333-8333-333333333333", (q) => q.query(`select id from appointments`));
    expect(r).toHaveLength(0);
  });
});
