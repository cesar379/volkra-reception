import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { endSimulation, sendSimulation, startSimulation } from "@/server/simulator/session";
import { pickOption } from "@/server/simulator/script-engine";
import { CLINIC, deps, freshDb, madrid } from "./helpers";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => db.close());

async function talk(lines: string[], d = deps(db)) {
  const start = await startSimulation(d, CLINIC, {});
  const transcript: string[] = [`A: ${start.replies.join(" ")}`];
  let last = start;
  for (const l of lines) {
    transcript.push(`C: ${l}`);
    last = await sendSimulation(d, CLINIC, start.sessionId, l, {});
    transcript.push(`A: ${last.replies.join(" ")}`);
  }
  return { sessionId: start.sessionId, transcript, last };
}

describe("simulador sin credenciales (guion local con herramientas reales)", () => {
  it("el flujo del ejemplo: pedir cita mañana por la tarde, elegir hora, dar nombre", async () => {
    const { transcript, last, sessionId } = await talk([
      "Hola, quería una limpieza mañana por la tarde",
    ]);
    expect(transcript.at(-1)).toMatch(/viernes 23 de octubre/);
    expect(transcript.at(-1)).toMatch(/¿Qué hora te viene mejor\?/);
    // Elegir la primera opción ofrecida, sea cual sea
    const second = await sendSimulation(deps(db), CLINIC, sessionId, "la primera", {});
    expect(second.replies.join(" ")).toMatch(/nombre y apellido/);
    const third = await sendSimulation(deps(db), CLINIC, sessionId, "Me llamo Laura Pérez", {});
    expect(third.replies.join(" ")).toMatch(/queda confirmada/);
    expect(third.events.some((e) => e.name === "reservar_cita" && e.ok)).toBe(true);
    const appt = await db.query<{ n: number }>(
      `select count(*)::int n from appointments a join customers c on c.id = a.customer_id where c.name = 'Laura Pérez' and a.is_simulated and a.status = 'confirmed'`,
    );
    expect(appt[0].n).toBe(1);
    void last;
    await endSimulation(deps(db), CLINIC, sessionId);
    const call = await db.query<{ outcome: string; status: string; summary: string; is_simulated: boolean }>(
      `select c.outcome, c.status, c.summary, c.is_simulated from calls c join simulator_sessions s on s.call_id = c.id where s.id = $1`, [sessionId],
    );
    expect(call[0]).toMatchObject({ outcome: "booked", status: "completed", is_simulated: true });
    expect(call[0].summary).toMatch(/Reserva/);
  });

  it("pregunta que no está en la configuración: no inventa y ofrece recado", async () => {
    const { transcript } = await talk(["¿Hacéis carillas de porcelana?"]);
    expect(transcript.at(-1)).toMatch(/no lo tengo|no quiero decirte algo incorrecto/i);
  });

  it("información configurada: responde con el dato real", async () => {
    const { transcript } = await talk(["¿Tenéis aparcamiento?"]);
    expect(transcript.at(-1)).toMatch(/parking público a 50 metros/);
  });

  it("pedir una persona en horario de apertura: transfiere y la llamada queda como transferida", async () => {
    const { last, sessionId } = await talk(["Quiero hablar con una persona"]);
    expect(last.ended).toBe(true);
    expect(last.endReason).toBe("transferred");
    const call = await db.query<{ status: string; outcome: string }>(`select c.status, c.outcome from calls c join simulator_sessions s on s.call_id = c.id where s.id = $1`, [sessionId]);
    expect(call[0]).toEqual({ status: "transferred", outcome: "transferred" });
  });

  it("pedir una persona fuera de horario: deja un recado", async () => {
    const sunday = deps(db, { now: () => madrid("2026-10-25", "21:00") });
    const { transcript } = await talk(["Quiero hablar con alguien", "Es por un presupuesto de ortodoncia", "Pedro Ruiz"], sunday);
    expect(transcript[2]).toMatch(/recado/);
    expect(transcript.at(-1)).toMatch(/te llamará/);
    const issues = await db.query<{ n: number }>(`select count(*)::int n from issues where kind = 'callback_request' and message like '%Pedro Ruiz%'`);
    expect(issues[0].n).toBe(1);
  });

  it("cancelar desde el mismo teléfono", async () => {
    const booked = await talk(["Quiero una revisión el jueves 5 de noviembre por la mañana", "la primera", "Ana Simulada"]);
    expect(booked.transcript.at(-1)).toMatch(/confirmada/);
    const { transcript } = await talk(["Quería cancelar mi cita", "sí"]);
    expect(transcript[2]).toMatch(/¿Quieres que la cancele\?/);
    expect(transcript.at(-1)).toMatch(/cancelada/);
  });
});

describe("elección de hora hablada", () => {
  const opts = [
    { inicio: "2026-10-23T17:00", decir: "viernes 23 de octubre a las cinco de la tarde", profesional_id: "a" },
    { inicio: "2026-10-23T18:30", decir: "viernes 23 de octubre a las seis y media de la tarde", profesional_id: "a" },
    { inicio: "2026-10-23T19:45", decir: "viernes 23 de octubre a las ocho menos cuarto de la tarde", profesional_id: "a" },
  ];
  it("entiende formas habituales", () => {
    expect(pickOption("a las cinco", opts)?.inicio).toBe("2026-10-23T17:00");
    expect(pickOption("las seis y media", opts)?.inicio).toBe("2026-10-23T18:30");
    expect(pickOption("18:30", opts)?.inicio).toBe("2026-10-23T18:30");
    expect(pickOption("a las ocho menos cuarto", opts)?.inicio).toBe("2026-10-23T19:45");
    expect(pickOption("la segunda", opts)?.inicio).toBe("2026-10-23T18:30");
    expect(pickOption("a las diez", opts)).toBeNull(); // no inventa una hora que no se ofreció
  });
});
