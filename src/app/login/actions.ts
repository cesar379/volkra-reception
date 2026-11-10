"use server";

import { redirect } from "next/navigation";
import { demoLoginEnabled, endSession, startDemoSession, supabaseServer } from "@/server/auth";
import { DEMO_USERS } from "@/server/db/seed";
import { env, features } from "@/server/env";
import { getDb } from "@/server/db";

export type LoginState = { error?: string; info?: string };

export async function demoLogin(formData: FormData) {
  if (!demoLoginEnabled()) redirect("/login");
  const id = String(formData.get("userId") ?? "");
  if (!Object.values(DEMO_USERS).some((u) => u.id === id)) redirect("/login");
  await getDb(); // asegura base local y datos de demostración
  await startDemoSession(id);
  redirect("/panel");
}

export async function signIn(_: LoginState, formData: FormData): Promise<LoginState> {
  if (!features.supabaseAuth) return { error: "El acceso con email no está configurado en este entorno." };
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { error: "Tu email aún no está confirmado. Abre el enlace del correo de confirmación (revisa también el spam)." };
    }
    return { error: "Email o contraseña incorrectos." };
  }
  redirect("/panel");
}

export async function signUp(_: LoginState, formData: FormData): Promise<LoginState> {
  if (!features.supabaseAuth) return { error: "El registro no está configurado en este entorno." };
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (password.length < 10) return { error: "La contraseña debe tener al menos 10 caracteres." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.code === "weak_password" ? "La contraseña es demasiado débil." : "No se ha podido crear la cuenta. Inténtalo de nuevo." };
  // Si el email ya tiene cuenta, Supabase no crea nada ni envía correo (y no lo dice, para no revelar
  // qué emails existen). Lo detectamos porque el usuario devuelto no tiene identidades.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return { error: "Ya existe una cuenta con este email. Pulsa «Ya tengo cuenta» para entrar." };
  }
  if (!data.session) return { info: "Te hemos enviado un email para confirmar la cuenta. Revisa también la carpeta de spam." };
  redirect("/nueva-empresa");
}

/** Envía el enlace para elegir otra contraseña. La respuesta es la misma exista o no la cuenta. */
export async function requestPasswordReset(_: LoginState, formData: FormData): Promise<LoginState> {
  if (!features.supabaseAuth) return { error: "El acceso con email no está configurado en este entorno." };
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Escribe un email válido." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.APP_URL.replace(/\/$/, "")}/auth/confirm?next=/nueva-contrasena`,
  });
  if (error?.code === "over_email_send_rate_limit" || error?.status === 429) {
    return { error: "Has pedido varios enlaces seguidos. Espera un minuto y vuelve a intentarlo." };
  }
  return { info: "Si hay una cuenta con ese email, te hemos enviado un enlace para elegir otra contraseña. Revisa también el spam." };
}

export async function updatePassword(_: LoginState, formData: FormData): Promise<LoginState> {
  if (!features.supabaseAuth) return { error: "El acceso con email no está configurado en este entorno." };
  const password = String(formData.get("password") ?? "");
  if (password.length < 10) return { error: "La contraseña debe tener al menos 10 caracteres." };
  if (password !== String(formData.get("confirm") ?? "")) return { error: "Las dos contraseñas no coinciden." };
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "El enlace ha caducado. Pide otro desde «¿Has olvidado tu contraseña?»." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { error: "Elige una contraseña distinta de la anterior." };
    if (error.code === "weak_password") return { error: "La contraseña es demasiado débil." };
    return { error: "No se ha podido cambiar la contraseña. Inténtalo de nuevo." };
  }
  redirect("/panel");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
