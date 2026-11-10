import type { Db } from "./client";
import { bookAppointment } from "../booking/service";
import { addDays, localDay, localToDate, isoWeekday } from "../booking/time";

/** Usuarios de demostración (solo existen en la base de datos local o si se ejecuta el seed a propósito). */
export const DEMO_USERS = {
  clinic: { id: "11111111-1111-4111-8111-111111111111", email: "demo-clinica@volkra.local", label: "Clínica Dental Alba (demo)" },
  garage: { id: "22222222-2222-4222-8222-222222222222", email: "demo-taller@volkra.local", label: "Taller Ruiz (demo)" },
} as const;

export const DEMO_BUSINESS_IDS = {
  clinic: "aaaaaaaa-0000-4000-8000-000000000001",
  garage: "aaaaaaaa-0000-4000-8000-000000000002",
} as const;

const TZ = "Europe/Madrid";

/** PRNG determinista para que la demo sea siempre igual */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export async function seedDemoIfEmpty(db: Db, now: Date) {
  const existing = await db.query<{ n: number }>(`select count(*)::int as n from businesses`);
  if (existing[0].n > 0) return false;
  await seedDemo(db, now);
  return true;
}

/**
 * Crea los negocios de demostración. Por defecto con usuarios de demo locales;
 * con ownerUserId (despliegue con Supabase) se asignan a un usuario real existente.
 */
export async function seedDemo(db: Db, now: Date, opts: { ownerUserId?: string } = {}) {
  const clinicOwner = opts.ownerUserId ?? DEMO_USERS.clinic.id;
  const garageOwner = opts.ownerUserId ?? DEMO_USERS.garage.id;
  await db.tx(async (q) => {
    if (!opts.ownerUserId) {
      for (const u of Object.values(DEMO_USERS)) {
        await q.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [u.id, u.email]);
      }
    }

    // --- Clínica dental ficticia en Madrid --------------------------------------------------
    const c = DEMO_BUSINESS_IDS.clinic;
    await q.query(
      `insert into businesses (id, name, vertical, description, address, public_phone, timezone, agent_name, welcome_message,
                               ai_instructions, transfer_number, minutes_saved_per_call, is_demo)
       values ($1, 'Clínica Dental Alba', 'clinica',
               'Clínica dental familiar en Madrid: odontología general, higiene, endodoncia, estética y ortodoncia invisible.',
               'Calle Ejemplo 14, 28010 Madrid (dirección ficticia de demostración)', '+34 910 00 00 00', 'Europe/Madrid', 'Lucía',
               'Hola, has llamado a Clínica Dental Alba. Soy Lucía, la asistente virtual con inteligencia artificial de la clínica. ¿En qué puedo ayudarte?',
               'Si alguien llama con dolor fuerte, hinchazón o fiebre, ofrece la primera cita de urgencia disponible. No des consejos médicos: si preguntan por medicación o síntomas, recomienda hablar con la doctora o acudir a urgencias si es grave.',
               '+34910000001', 4, true)`,
      [c],
    );
    await q.query(`insert into memberships (user_id, business_id, role) values ($1, $2, 'owner')`, [clinicOwner, c]);

    for (const wd of [1, 2, 3, 4, 5]) {
      await q.query(`insert into business_hours (business_id, weekday, opens, closes) values ($1,$2,'09:30','14:00'), ($1,$2,'16:00','20:30')`, [c, wd]);
    }
    await q.query(`insert into business_hours (business_id, weekday, opens, closes) values ($1, 6, '10:00', '14:00')`, [c]);

    const holidays: [string, boolean, string, string][] = [
      ["2026-11-09", true, "[]", "Festivo local: Nuestra Señora de la Almudena"],
      ["2026-12-08", true, "[]", "Festivo nacional: Inmaculada Concepción"],
      ["2026-12-24", false, '[{"opens":"10:00","closes":"13:00"}]', "Nochebuena: horario reducido"],
      ["2026-12-25", true, "[]", "Navidad"],
      ["2027-01-01", true, "[]", "Año Nuevo"],
      ["2027-01-06", true, "[]", "Reyes"],
    ];
    for (const [day, closed, hours, reason] of holidays) {
      await q.query(`insert into special_days (business_id, day, closed, hours, reason) values ($1,$2,$3,$4::jsonb,$5)`, [c, day, closed, hours, reason]);
    }

    const staff = {
      ortega: "bbbbbbbb-0000-4000-8000-000000000001",
      salas: "bbbbbbbb-0000-4000-8000-000000000002",
      gil: "bbbbbbbb-0000-4000-8000-000000000003",
    };
    await q.query(
      `insert into staff (id, business_id, name, role_title, color) values
        ($1, $4, 'Dra. Marta Ortega', 'Odontóloga general', '#4A5D5E'),
        ($2, $4, 'Dr. Javier Salas', 'Endodoncista', '#3A4547'),
        ($3, $4, 'Laura Gil', 'Higienista dental', '#8A917F')`,
      [staff.ortega, staff.salas, staff.gil, c],
    );
    // Dr. Salas: lunes, miércoles y viernes. Laura: solo mañanas de lunes a sábado.
    for (const wd of [1, 3, 5]) {
      await q.query(`insert into staff_hours (business_id, staff_id, weekday, opens, closes) values ($1,$2,$3,'09:30','14:00'), ($1,$2,$3,'16:00','20:30')`, [c, staff.salas, wd]);
    }
    for (const wd of [1, 2, 3, 4, 5]) {
      await q.query(`insert into staff_hours (business_id, staff_id, weekday, opens, closes) values ($1,$2,$3,'09:30','14:00')`, [c, staff.gil, wd]);
    }
    await q.query(`insert into staff_hours (business_id, staff_id, weekday, opens, closes) values ($1,$2,6,'10:00','14:00')`, [c, staff.gil]);

    const services: [string, string, string, number, number, number | null, boolean, string[]][] = [
      ["cccccccc-0000-4000-8000-000000000001", "Revisión y diagnóstico", "Primera visita gratuita con exploración y radiografía si hace falta.", 30, 0, 0, false, [staff.ortega, staff.salas]],
      ["cccccccc-0000-4000-8000-000000000002", "Limpieza dental", "Higiene profesional (tartrectomía).", 45, 0, 4500, false, [staff.gil, staff.ortega]],
      ["cccccccc-0000-4000-8000-000000000003", "Empaste", "Obturación de una pieza. El precio final depende del tamaño.", 45, 0, 6000, true, [staff.ortega, staff.salas]],
      ["cccccccc-0000-4000-8000-000000000004", "Endodoncia", "Tratamiento de conductos.", 90, 15, 18000, true, [staff.salas]],
      ["cccccccc-0000-4000-8000-000000000005", "Blanqueamiento dental", "Blanqueamiento en clínica, una sesión.", 60, 0, 25000, false, [staff.ortega]],
      ["cccccccc-0000-4000-8000-000000000006", "Urgencia dental", "Dolor, rotura o inflamación. Se valora y se alivia en la misma cita.", 30, 0, 4000, false, [staff.ortega, staff.salas]],
      ["cccccccc-0000-4000-8000-000000000007", "Estudio de ortodoncia invisible", "Escáner 3D y plan de tratamiento. Gratuito.", 45, 0, 0, false, [staff.ortega]],
    ];
    for (const [id, name, desc, dur, buf, price, from, who] of services) {
      await q.query(
        `insert into services (id, business_id, name, description, duration_min, buffer_min, price_cents, price_from) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, c, name, desc, dur, buf, price, from],
      );
      for (const s of who) await q.query(`insert into staff_services (business_id, staff_id, service_id) values ($1,$2,$3)`, [c, s, id]);
    }

    const faqs: [string, string][] = [
      ["¿Hay aparcamiento?", "Hay un parking público a 50 metros, en la misma calle. La clínica no tiene parking propio."],
      ["¿Trabajáis con seguros?", "Trabajamos con Adeslas, Sanitas y DKV. Con otros seguros se puede venir como paciente privado."],
      ["¿Se puede financiar?", "Sí, los tratamientos de más de 300 € se pueden financiar hasta en 12 meses sin intereses, sujeto a aprobación de la financiera."],
      ["¿Cómo se puede pagar?", "En efectivo, con tarjeta o con Bizum."],
      ["¿Atendéis a niños?", "Sí, atendemos a niños a partir de 3 años."],
      ["¿Qué pasa si llego tarde?", "Esperamos hasta 15 minutos. Si es más, puede que haya que cambiar la cita."],
      ["¿Cómo cancelo una cita?", "Se puede cancelar o cambiar llamando a este mismo número, mejor con 24 horas de antelación."],
    ];
    for (const [i, [question, answer]] of faqs.entries()) {
      await q.query(`insert into faqs (business_id, question, answer, position) values ($1,$2,$3,$4)`, [c, question, answer, i]);
    }

    // --- Segundo negocio (otro sector, otro dueño): demuestra multiempresa y aislamiento --------
    const g = DEMO_BUSINESS_IDS.garage;
    await q.query(
      `insert into businesses (id, name, vertical, description, address, public_phone, agent_name, welcome_message, transfer_number, is_demo)
       values ($1, 'Taller Ruiz', 'taller', 'Taller mecánico de barrio: mantenimiento, neumáticos y pre-ITV.',
               'Calle Ejemplo 3, 28045 Madrid (dirección ficticia de demostración)', '+34 910 00 00 10', 'Diego',
               'Hola, has llamado a Taller Ruiz. Soy Diego, el asistente virtual con inteligencia artificial del taller. ¿Qué necesitas?',
               '+34910000011', true)`,
      [g],
    );
    await q.query(`insert into memberships (user_id, business_id, role) values ($1, $2, 'owner')`, [garageOwner, g]);
    for (const wd of [1, 2, 3, 4, 5]) {
      await q.query(`insert into business_hours (business_id, weekday, opens, closes) values ($1,$2,'08:00','13:30'), ($1,$2,'15:00','19:00')`, [g, wd]);
    }
    await q.query(
      `insert into staff (id, business_id, name, role_title, color) values
        ('bbbbbbbb-0000-4000-8000-000000000011', $1, 'Elevador 1', 'Puesto de trabajo', '#4A5D5E'),
        ('bbbbbbbb-0000-4000-8000-000000000012', $1, 'Elevador 2', 'Puesto de trabajo', '#8A917F')`,
      [g],
    );
    const gServices: [string, string, number, number | null, boolean][] = [
      ["cccccccc-0000-4000-8000-000000000011", "Cambio de aceite y filtros", 60, 6900, false],
      ["cccccccc-0000-4000-8000-000000000012", "Revisión pre-ITV", 45, 3500, false],
      ["cccccccc-0000-4000-8000-000000000013", "Cambio de neumáticos", 60, 4000, true],
    ];
    for (const [id, name, dur, price, from] of gServices) {
      await q.query(`insert into services (id, business_id, name, duration_min, price_cents, price_from) values ($1,$2,$3,$4,$5,$6)`, [id, g, name, dur, price, from]);
      for (const s of ["bbbbbbbb-0000-4000-8000-000000000011", "bbbbbbbb-0000-4000-8000-000000000012"]) {
        await q.query(`insert into staff_services (business_id, staff_id, service_id) values ($1,$2,$3)`, [g, s, id]);
      }
    }

    await seedSimulatedHistory(q, c, now, staff, services.map((s) => ({ id: s[0], name: s[1], dur: s[3] + s[4], who: s[7] })));
  });

  await seedUpcomingAppointments(db, now);
}

const NAMES = ["Ana García", "Pablo Romero", "Lucía Martín", "Jorge Navarro", "Carmen Ruiz", "Sergio Díaz", "Elena Torres", "Raúl Moreno",
  "Marta Gil", "Iván Castro", "Nuria Vega", "Álvaro Prieto", "Sara Molina", "Hugo Serrano", "Paula Ortiz", "Diego Rubio"];

type Q = { query: Db["query"] };

/** Historial de llamadas de los últimos 14 días. Todo marcado como simulado. */
async function seedSimulatedHistory(
  q: Q,
  businessId: string,
  now: Date,
  staff: Record<string, string>,
  services: { id: string; name: string; dur: number; who: string[] }[],
) {
  const rand = rng(42);
  const today = localDay(now, TZ);
  let customerN = 0;
  const outcomes: [string, number][] = [["booked", 0.42], ["info", 0.24], ["transferred", 0.1], ["cancelled", 0.08], ["rescheduled", 0.06], ["message", 0.05], ["no_action", 0.04], ["error", 0.01]];
  const pick = () => {
    let r = rand();
    for (const [o, p] of outcomes) { if ((r -= p) <= 0) return o; }
    return "info";
  };
  const summaries: Record<string, (s: string) => string> = {
    booked: (s) => `La persona pidió cita para ${s.toLowerCase()} y se reservó en el primer hueco que le venía bien.`,
    info: () => ["Preguntó por el horario del sábado.", "Preguntó si trabajamos con Sanitas.", "Preguntó el precio de la limpieza dental.", "Preguntó si hay aparcamiento cerca.", "Preguntó por la financiación de la ortodoncia."][Math.floor(rand() * 5)],
    transferred: () => "Pidió hablar con la doctora sobre un presupuesto y se transfirió la llamada a recepción.",
    cancelled: () => "Canceló su cita por un viaje de trabajo.",
    rescheduled: () => "Cambió su cita a otro día de la misma semana.",
    message: () => "Llamó fuera de horario y dejó un recado para que le devuelvan la llamada.",
    no_action: () => "La persona colgó antes de decir qué necesitaba.",
    error: () => "Hubo un problema técnico al consultar la agenda; se ofreció dejar un recado.",
  };
  const usedSlots = new Set<string>();

  for (let d = 14; d >= 1; d--) {
    const day = addDays(today, -d, TZ);
    const wd = isoWeekday(day, TZ);
    if (wd === 7) continue;
    const nCalls = wd === 6 ? 2 + Math.floor(rand() * 2) : 3 + Math.floor(rand() * 5);
    for (let i = 0; i < nCalls; i++) {
      const hour = 8 + Math.floor(rand() * 14); // también fuera de horario
      const minute = Math.floor(rand() * 60);
      const startedAt = localToDate(day, `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, TZ);
      const outcome = pick();
      const duration = outcome === "no_action" ? 8 + Math.floor(rand() * 20) : 45 + Math.floor(rand() * 200);
      const service = services[Math.floor(rand() * 3)];
      const status = outcome === "transferred" ? "transferred" : outcome === "error" ? "failed" : "completed";
      const call = await q.query<{ id: string }>(
        `insert into calls (business_id, provider, provider_call_id, started_at, ended_at, duration_sec, caller_last4, status, outcome,
                            ended_reason, summary, is_simulated, needs_review)
         values ($1, 'simulator', $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11) returning id`,
        [businessId, `seed-${day}-${i}`, startedAt, new Date(startedAt.getTime() + duration * 1000), duration,
         String(1000 + Math.floor(rand() * 9000)), status, outcome,
         outcome === "transferred" ? "assistant-forwarded-call" : "customer-ended-call",
         summaries[outcome](service.name), outcome === "error"],
      );
      if (outcome === "booked" && wd !== 6) {
        // Cita ya pasada asociada a la llamada (completada)
        const t = ["10:00", "11:00", "12:00", "17:00", "18:00", "19:00"][Math.floor(rand() * 6)];
        const who = service.who[Math.floor(rand() * service.who.length)];
        const key = `${who}-${day}-${t}`;
        if (!usedSlots.has(key)) {
          usedSlots.add(key);
          const customer = await q.query<{ id: string }>(
            `insert into customers (business_id, name, phone) values ($1, $2, $3) returning id`,
            [businessId, NAMES[customerN % NAMES.length], `+340000${String(10000 + customerN).slice(-5)}`],
          );
          customerN++;
          const s = localToDate(day, t, TZ);
          await q.query(
            `insert into appointments (business_id, service_id, staff_id, customer_id, starts_at, ends_at, status, source, booking_code, call_id, is_simulated)
             values ($1,$2,$3,$4,$5,$6,'completed','simulator',$7,$8,true)`,
            [businessId, service.id, who, customer[0].id, s, new Date(s.getTime() + service.dur * 60000), `S${String(customerN).padStart(5, "0")}`, call[0].id],
          );
        }
      }
      if (outcome === "message") {
        await q.query(`insert into issues (business_id, kind, message, call_id, created_at) values ($1, 'callback_request', $2, $3, $4)`,
          [businessId, "Devolver llamada: pregunta por el presupuesto de un implante (datos simulados).", call[0].id, startedAt]);
      }
      if (outcome === "error") {
        await q.query(`insert into issues (business_id, kind, message, call_id, created_at) values ($1, 'tool_error', $2, $3, $4)`,
          [businessId, "No se pudo consultar la agenda durante la llamada; la persona dejó un recado (datos simulados).", call[0].id, startedAt]);
      }
    }
  }
  await q.query(`insert into issues (business_id, kind, message, created_at) values ($1, 'unknown_question', $2, $3)`,
    [businessId, "Un paciente preguntó si hacemos implantes con carga inmediata y el asistente no tenía esa información. Conviene añadirla a las preguntas frecuentes (datos simulados).", addDaysDate(now, -2)]);
  void staff;
}

function addDaysDate(d: Date, n: number) {
  return new Date(d.getTime() + n * 86400000);
}

/** Citas futuras reservadas con el motor real (validan horarios y solapes). */
async function seedUpcomingAppointments(db: Db, now: Date) {
  const rand = rng(7);
  const c = DEMO_BUSINESS_IDS.clinic;
  const deps = { db, now: () => now };
  const today = localDay(now, TZ);
  const svc = ["cccccccc-0000-4000-8000-000000000001", "cccccccc-0000-4000-8000-000000000002", "cccccccc-0000-4000-8000-000000000003", "cccccccc-0000-4000-8000-000000000006"];
  let n = 100;
  for (let d = 1; d <= 8; d++) {
    const day = addDays(today, d, TZ);
    for (const t of ["10:00", "11:30", "12:30", "16:30", "18:00", "19:15"]) {
      if (rand() < 0.45) continue;
      const res = await bookAppointment(deps, {
        businessId: c,
        serviceId: svc[Math.floor(rand() * svc.length)],
        start: localToDate(day, t, TZ),
        customer: { name: NAMES[n % NAMES.length], phone: `+340000${String(n).padStart(5, "0")}` },
        source: "simulator",
        isSimulated: true,
      });
      void res; // si el hueco no existe (festivo, cerrado, profesional ausente) simplemente no se crea
      n++;
    }
  }
}
