import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/server/auth";
import { env, features } from "@/server/env";
import { safeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

/**
 * Destino de los enlaces de los emails de Supabase (recuperar contraseña, confirmar cuenta).
 * Admite los dos formatos: `token_hash` (plantilla propia, funciona en cualquier navegador)
 * y `code` (enlace por defecto de Supabase, solo en el navegador donde se pidió).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const to = (path: string) => NextResponse.redirect(new URL(path, env.APP_URL));
  if (!features.supabaseAuth) return to("/login");

  const supabase = await supabaseServer();
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const { error } = tokenHash && type
    ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error("sin token") };
  return to(error ? "/login?aviso=enlace" : next);
}
