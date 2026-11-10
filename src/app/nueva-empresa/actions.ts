"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { getDb } from "@/server/db";

/** Plantillas de arranque por sector: horario habitual y servicios de ejemplo para editar. */
const TEMPLATES: Record<string, { hours: [number, string, string][]; services: [string, number, number | null][]; staff: string[] }> = {
  clinica: { hours: [1, 2, 3, 4, 5].flatMap((d) => [[d, "09:30", "14:00"], [d, "16:00", "20:00"]] as [number, string, string][]), services: [["Primera visita", 30, 0], ["Revisión", 30, null]], staff: ["Profesional 1"] },
  peluqueria: { hours: [2, 3, 4, 5, 6].map((d) => [d, "10:00", "20:00"] as [number, string, string]), services: [["Corte", 30, 1800], ["Corte y peinado", 45, 2800], ["Color", 90, null]], staff: ["Estilista 1"] },
  taller: { hours: [1, 2, 3, 4, 5].flatMap((d) => [[d, "08:00", "13:30"], [d, "15:00", "19:00"]] as [number, string, string][]), services: [["Diagnóstico", 30, null], ["Cambio de aceite", 60, null]], staff: ["Puesto 1"] },
  academia: { hours: [1, 2, 3, 4, 5].map((d) => [d, "16:00", "21:00"] as [number, string, string]), services: [["Clase de prueba", 60, 0], ["Entrevista informativa", 30, 0]], staff: ["Profesor/a 1"] },
  otro: { hours: [1, 2, 3, 4, 5].map((d) => [d, "09:00", "18:00"] as [number, string, string]), services: [["Cita", 30, null]], staff: ["Persona 1"] },
};

export async function createBusiness(fd: FormData) {
  const session = await requireSession();
  const parsed = z.object({ name: z.string().trim().min(2).max(120), vertical: z.enum(["clinica", "peluqueria", "taller", "academia", "otro"]) })
    .safeParse({ name: fd.get("name"), vertical: fd.get("vertical") });
  if (!parsed.success) redirect("/nueva-empresa?error=1");
  const tpl = TEMPLATES[parsed.data.vertical];
  const db = await getDb();
  const id = await db.asUser(session.userId, async (q) => {
    const r = await q.query<{ id: string }>(`select public.create_business($1, $2) as id`, [parsed.data.name, parsed.data.vertical]);
    const bid = r[0].id;
    // Los avisos (citas y recados) van por defecto al email de quien crea el negocio; se cambia en Configuración.
    const ownerEmail = session.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(session.email) ? session.email : null;
    await q.query(`update businesses set welcome_message = $2, notify_email = $3 where id = $1`, [bid, `Hola, has llamado a ${parsed.data.name}. Soy Lucía, la asistente virtual con inteligencia artificial. ¿En qué puedo ayudarte?`, ownerEmail]);
    for (const [w, o, c] of tpl.hours) await q.query(`insert into business_hours (business_id, weekday, opens, closes) values ($1,$2,$3,$4)`, [bid, w, o, c]);
    const staffIds: string[] = [];
    for (const name of tpl.staff) staffIds.push((await q.query<{ id: string }>(`insert into staff (business_id, name) values ($1,$2) returning id`, [bid, name]))[0].id);
    for (const [name, dur, price] of tpl.services) {
      const sid = (await q.query<{ id: string }>(`insert into services (business_id, name, duration_min, price_cents) values ($1,$2,$3,$4) returning id`, [bid, name, dur, price]))[0].id;
      for (const st of staffIds) await q.query(`insert into staff_services (business_id, staff_id, service_id) values ($1,$2,$3)`, [bid, st, sid]);
    }
    return bid;
  });
  (await cookies()).set("volkra_business", id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/configuracion?tab=negocio&guardado=1");
}
