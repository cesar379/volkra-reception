import fs from "node:fs";
import path from "node:path";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  kind: "embedded" | "postgres";
  /** Transacción como propietario de la base de datos (servidor). Úsese siempre filtrando por business_id. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Transacción con el rol "authenticated" y el usuario indicado: aplica Row Level Security. */
  asUser<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type CreateDbOptions = {
  databaseUrl?: string;
  dataDir?: string; // carpeta para PGlite; "memory://" para tests
  seedDemo?: boolean;
  now?: () => Date;
};

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const SHIM = path.join(process.cwd(), "supabase", "local", "shim.sql");

async function enterUser(q: Queryable, userId: string) {
  await q.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await q.query(`set local role authenticated`);
}

/** Parámetros json/jsonb: un texto ya es JSON serializado; cualquier otro valor se serializa. */
export function serializeJsonParam(x: unknown): string {
  return typeof x === "string" ? x : JSON.stringify(x);
}

export async function createDb(opts: CreateDbOptions): Promise<Db> {
  if (opts.databaseUrl) return createPostgres(opts.databaseUrl);
  return createEmbedded(opts);
}

async function createPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  // prepare:false es necesario con el pooler de Supabase en modo transacción
  const sql = postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    types: {
      bigint: postgres.BigInt,
      // El código pasa JSON ya serializado (texto) a parámetros ::jsonb, igual que con PGlite.
      // Por defecto postgres.js lo volvería a serializar y guardaría un texto JSON en vez de un objeto.
      json: { to: 114, from: [114], serialize: serializeJsonParam, parse: (x: string) => JSON.parse(x) },
      jsonb: { to: 3802, from: [3802], serialize: serializeJsonParam, parse: (x: string) => JSON.parse(x) },
    },
  });
  type Unsafe = { unsafe: (text: string, params?: never[]) => PromiseLike<unknown> };
  const wrap = (s: Unsafe): Queryable => ({
    async query<T>(text: string, params: unknown[] = []) {
      return (await s.unsafe(text, params as never[])) as T[];
    },
  });
  const base = wrap(sql);
  return {
    kind: "postgres",
    query: base.query,
    tx: (fn) => sql.begin((t) => fn(wrap(t))) as never,
    asUser: (userId, fn) =>
      sql.begin(async (t) => {
        const q = wrap(t);
        await enterUser(q, userId);
        return fn(q);
      }) as never,
    close: () => sql.end(),
  };
}

async function createEmbedded(opts: CreateDbOptions): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const dir = opts.dataDir ?? ".data/pglite";
  if (!dir.startsWith("memory://")) fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
  const pg = await PGlite.create(dir.startsWith("memory://") ? undefined : dir, { extensions: { btree_gist } });

  const wrap = (s: { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Queryable => ({
    async query<T>(text: string, params: unknown[] = []) {
      return (await s.query(text, params)).rows as T[];
    },
  });
  const base = wrap(pg);
  const db: Db = {
    kind: "embedded",
    query: base.query,
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
    asUser: (userId, fn) =>
      pg.transaction(async (t) => {
        const q = wrap(t);
        await enterUser(q, userId);
        return fn(q);
      }),
    close: () => pg.close(),
  };

  await migrateEmbedded(pg);
  if (opts.seedDemo) {
    const { seedDemoIfEmpty } = await import("./seed");
    await seedDemoIfEmpty(db, opts.now?.() ?? new Date());
  }
  return db;
}

async function migrateEmbedded(pg: { exec: (sql: string) => Promise<unknown>; query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }) {
  await pg.exec(`create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())`);
  await pg.exec(fs.readFileSync(SHIM, "utf8"));
  const applied = new Set(((await pg.query(`select name from public._migrations`)).rows as { name: string }[]).map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    await pg.exec(`begin; ${fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")}; insert into public._migrations(name) values ('${f}'); commit;`);
  }
}

/** Aplica migraciones pendientes en un Postgres real (Supabase). Se usa desde scripts/db-migrate.ts. */
export async function migratePostgres(url: string, log: (m: string) => void = console.log) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    await sql.unsafe(`create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())`);
    const applied = new Set((await sql.unsafe(`select name from public._migrations`)).map((r) => r.name as string));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (applied.has(f)) continue;
      await sql.begin(async (t) => {
        await t.unsafe(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
        await t.unsafe(`insert into public._migrations(name) values ($1)`, [f]);
      });
      log(`aplicada ${f}`);
    }
  } finally {
    await sql.end();
  }
}

export function isExclusionViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23P01";
}
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
