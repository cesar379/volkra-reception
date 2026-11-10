import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { env, features } from "./env";
import { hmac as sign, safeEqual } from "./crypto";
import { getDb } from "./db";
import type { Queryable } from "./db/client";
import { DEMO_USERS } from "./db/seed";
import { claimInvites } from "./team";

export type Session = { userId: string; email: string | null; mode: "supabase" | "demo" };

const DEMO_COOKIE = "volkra_demo";
const BUSINESS_COOKIE = "volkra_business";

/** El acceso de demostración solo existe sin Supabase o si se habilita expresamente (ALLOW_DEMO_LOGIN=true). */
export function demoLoginEnabled() {
  return !features.supabaseAuth || process.env.ALLOW_DEMO_LOGIN === "true";
}

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          // Llamado desde un Server Component: el proxy refresca la sesión.
        }
      },
    },
  });
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  if (demoLoginEnabled()) {
    const raw = store.get(DEMO_COOKIE)?.value;
    if (raw) {
      const [userId, sig] = raw.split(".");
      const known = Object.values(DEMO_USERS).find((u) => u.id === userId);
      if (known && sig && safeEqual(sig, sign(userId))) {
        return { userId, email: known.email, mode: "demo" };
      }
    }
  }
  if (features.supabaseAuth) {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    if (data.user) return { userId: data.user.id, email: data.user.email ?? null, mode: "supabase" };
  }
  return null;
}

export async function startDemoSession(userId: string) {
  const store = await cookies();
  store.set(DEMO_COOKIE, `${userId}.${sign(userId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  store.delete(BUSINESS_COOKIE);
}

export async function endSession() {
  const store = await cookies();
  store.delete(DEMO_COOKIE);
  store.delete(BUSINESS_COOKIE);
  if (features.supabaseAuth) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
}

export type MembershipBusiness = { id: string; name: string; vertical: string; is_demo: boolean; role: string };

export async function listMyBusinesses(session: Session): Promise<MembershipBusiness[]> {
  const db = await getDb();
  return db.asUser(session.userId, (q) =>
    q.query<MembershipBusiness>(
      `select b.id, b.name, b.vertical, b.is_demo, m.role
         from memberships m join businesses b on b.id = m.business_id
        where m.user_id = auth.uid() order by b.created_at, b.name, b.id`, // orden estable: la empresa por defecto no cambia entre peticiones
    ),
  );
}

export type AppContext = {
  session: Session;
  business: MembershipBusiness;
  businesses: MembershipBusiness[];
  /** Ejecuta consultas como el usuario (con Row Level Security). */
  asUser: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>;
};

/** Sesión + empresa activa. Redirige a login o al alta de empresa si falta algo. */
export async function requireApp(): Promise<AppContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mode === "supabase") {
    await ensureAuthUserMirror(session);
    // Invitaciones pendientes para este email: se convierten en acceso al entrar.
    await claimInvites(await getDb(), session.userId, session.email);
  }
  const businesses = await listMyBusinesses(session);
  if (businesses.length === 0) redirect("/nueva-empresa");
  const store = await cookies();
  const wanted = store.get(BUSINESS_COOKIE)?.value;
  const business = businesses.find((b) => b.id === wanted) ?? businesses[0];
  const db = await getDb();
  return { session, business, businesses, asUser: (fn) => db.asUser(session.userId, fn) };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function setActiveBusiness(businessId: string) {
  const session = await requireSession();
  const list = await listMyBusinesses(session);
  if (!list.some((b) => b.id === businessId)) throw new Error("Sin acceso a esa empresa");
  (await cookies()).set(BUSINESS_COOKIE, businessId, { httpOnly: true, sameSite: "lax", path: "/", secure: env.NODE_ENV === "production" });
}

/**
 * Con Supabase, auth.users ya existe en la misma base de datos. Esta función solo actúa en la base
 * embebida local si alguien usa Supabase Auth contra ella (no es lo habitual).
 */
async function ensureAuthUserMirror(session: Session) {
  const db = await getDb();
  if (db.kind !== "embedded") return;
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [session.userId, session.email]);
}
