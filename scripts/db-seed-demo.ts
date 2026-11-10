/**
 * Crea los negocios de demostración (clínica y taller ficticios, datos simulados) en Postgres/Supabase
 * y se los asigna a un usuario EXISTENTE de Supabase Auth, para enseñar el producto en un despliegue real.
 * Uso:  DATABASE_URL="postgresql://..." npm run db:seed-demo -- tu-email@volkra.es
 */
import { createDb } from "../src/server/db/client";
import { seedDemo } from "../src/server/db/seed";

async function main() {
  const email = process.argv[2];
  if (!process.env.DATABASE_URL || !email) {
    console.error("Uso: DATABASE_URL=... npm run db:seed-demo -- email@dominio.es");
    process.exit(1);
  }
  const db = await createDb({ databaseUrl: process.env.DATABASE_URL });
  try {
    const user = (await db.query<{ id: string }>(`select id from auth.users where email = $1`, [email]))[0];
    if (!user) throw new Error(`No existe ningún usuario con el email ${email}. Regístrate primero en la app.`);
    const exists = await db.query(`select 1 from businesses where is_demo limit 1`);
    if (exists.length) throw new Error("Ya hay negocios de demostración en esta base de datos.");
    await seedDemo(db, new Date(), { ownerUserId: user.id });
    console.log(`Negocios de demostración creados y asignados a ${email}.`);
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
