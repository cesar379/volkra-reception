/**
 * Aplica las migraciones SQL pendientes en Postgres/Supabase.
 * Uso:  DATABASE_URL="postgresql://..." npm run db:migrate
 * (Alternativa: `supabase db push` con la CLI de Supabase, que lee la misma carpeta supabase/migrations.)
 */
import { migratePostgres } from "../src/server/db/client";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}
migratePostgres(url)
  .then(() => console.log("Migraciones al día."))
  .catch((err) => {
    console.error("Error aplicando migraciones:", err.message);
    process.exit(1);
  });
