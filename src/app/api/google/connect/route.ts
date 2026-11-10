import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireApp } from "@/server/auth";
import { env, features } from "@/server/env";
import { GOOGLE_SCOPES } from "@/server/calendar/google";
import { hmac } from "@/server/crypto";

export const dynamic = "force-dynamic";

/** Inicia OAuth con Google para el negocio activo (protección CSRF con estado firmado en cookie). */
export async function GET() {
  const ctx = await requireApp();
  if (!features.google) return NextResponse.redirect(new URL("/configuracion?tab=integraciones&error=Google%20no%20configurado", env.APP_URL));
  const nonce = crypto.randomBytes(16).toString("base64url");
  const state = `${ctx.business.id}.${nonce}.${hmac(`${ctx.business.id}.${nonce}.${ctx.session.userId}`)}`;
  (await cookies()).set("volkra_google_state", state, { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/", maxAge: 600 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${env.APP_URL.replace(/\/$/, "")}/api/google/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return NextResponse.redirect(url);
}
