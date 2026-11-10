/**
 * Se ejecuta antes de `next build` (npm "prebuild"). En los despliegues de producción de Vercel aplica
 * las migraciones pendientes con la DATABASE_URL del proyecto, para que el código nuevo nunca llegue
 * antes que su esquema. Si una migración falla, el build falla y Vercel mantiene el despliegue anterior.
 * En local, en previews o sin DATABASE_URL no hace nada.
 */
import { migratePostgres } from "../src/server/db/client";

const url = process.env.DATABASE_URL?.trim();
if (process.env.VERCEL_ENV !== "production") {
  console.log("[migraciones] No es un despliegue de producción de Vercel: no se aplican.");
} else if (!url) {
  console.log("[migraciones] Sin DATABASE_URL: no hay base de datos que migrar.");
} else {
  migratePostgres(url, (m) => console.log(`[migraciones] ${m}`))
    .then(() => console.log("[migraciones] Base de datos al día."))
    .catch((err) => {
      console.error("[migraciones] Error, se cancela el despliegue:", err.message);
      process.exit(1);
    });
}
