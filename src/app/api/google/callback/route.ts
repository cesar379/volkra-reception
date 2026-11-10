import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireApp } from "@/server/auth";
import { env } from "@/server/env";
import { encrypt, hmac, safeEqual } from "@/server/crypto";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await requireApp();
  const url = new URL(request.url);
  const back = (msg?: string) => NextResponse.redirect(new URL(`/configuracion?tab=integraciones&${msg ? `error=${encodeURIComponent(msg)}` : "guardado=1"}`, env.APP_URL));
  const store = await cookies();
  const expected = store.get("volkra_google_state")?.value;
  store.delete("volkra_google_state");
  const state = url.searchParams.get("state") ?? "";
  const [businessId, nonce, sig] = state.split(".");
  if (!expected || !safeEqual(state, expected) || !sig || !safeEqual(sig, hmac(`${businessId}.${nonce}.${ctx.session.userId}`)) || businessId !== ctx.business.id) {
    return back("La conexión con Google no es válida. Inténtalo de nuevo.");
  }
  const code = url.searchParams.get("code");
  if (!code) return back(url.searchParams.get("error") === "access_denied" ? "Has cancelado la conexión con Google." : "Google no devolvió autorización.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${env.APP_URL.replace(/\/$/, "")}/api/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return back(`Google rechazó la conexión (${res.status}).`);
  const tok = (await res.json()) as { refresh_token?: string; id_token?: string };
  if (!tok.refresh_token) return back("Google no devolvió acceso permanente. Quita el acceso de Volkra en tu cuenta de Google y vuelve a conectar.");
  let email: string | null = null;
  try {
    email = tok.id_token ? (JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email ?? null : null;
  } catch { /* opcional */ }

  const db = await getDb();
  await db.query(
    `insert into google_credentials (business_id, refresh_token_enc, account_email) values ($1, $2, $3)
     on conflict (business_id) do update set refresh_token_enc = excluded.refresh_token_enc, account_email = excluded.account_email, updated_at = now()`,
    [ctx.business.id, encrypt(tok.refresh_token), email],
  );
  await db.query(`update businesses set google_connected = true, google_calendar_id = coalesce(google_calendar_id, 'primary') where id = $1`, [ctx.business.id]);
  return back();
}
