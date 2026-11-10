import "server-only";
import { createDb, type Db } from "./client";
import { env } from "../env";

/**
 * Una sola conexión por proceso. En local sin credenciales se usa Postgres embebido (PGlite)
 * con los mismos ficheros de migración que Supabase; con DATABASE_URL se usa Postgres/Supabase.
 */
const g = globalThis as unknown as { __volkraDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!g.__volkraDb) {
    g.__volkraDb = createDb({
      databaseUrl: env.DATABASE_URL,
      dataDir: env.LOCAL_DB_DIR,
      seedDemo: env.SEED_DEMO,
    }).catch((err) => {
      g.__volkraDb = undefined;
      throw err;
    });
  }
  return g.__volkraDb;
}

export type { Db, Queryable } from "./client";
