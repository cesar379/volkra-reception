"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset, signIn, signUp, updatePassword, type LoginState } from "./actions";

type Mode = "in" | "up" | "reset";
const ACTIONS = { in: signIn, up: signUp, reset: requestPasswordReset };
const SUBMIT = { in: "Entrar", up: "Crear cuenta", reset: "Enviar enlace" };

export function EmailForm() {
  const [mode, setMode] = useState<Mode>("in");
  // Una instancia por modo: al cambiar de modo, el mensaje anterior desaparece.
  return <ModeForm key={mode} mode={mode} setMode={setMode} />;
}

function ModeForm({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(ACTIONS[mode], {});
  const link = "text-sm text-muted-foreground underline-offset-4 hover:underline";
  return (
    <form action={action} className="grid gap-3">
      {mode === "reset" ? <p className="text-sm text-muted-foreground">Te enviaremos un enlace para elegir una contraseña nueva.</p> : null}
      <div className="grid gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {mode !== "reset" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" name="password" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={mode === "up" ? 10 : undefined} />
        </div>
      ) : null}
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      {state.info ? <p className="text-sm text-success" role="status">{state.info}</p> : null}
      <Button type="submit" size="lg" disabled={pending}>{pending ? "Un momento…" : SUBMIT[mode]}</Button>
      {mode === "in" ? (
        <>
          <button type="button" className={link} onClick={() => setMode("reset")}>¿Has olvidado tu contraseña?</button>
          <button type="button" className={link} onClick={() => setMode("up")}>¿No tienes cuenta? Crear una</button>
        </>
      ) : (
        <button type="button" className={link} onClick={() => setMode("in")}>{mode === "up" ? "Ya tengo cuenta" : "Volver a entrar"}</button>
      )}
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(updatePassword, {});
  return (
    <form action={action} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="password">Contraseña nueva</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirm">Repítela</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </div>
      <p className="text-xs text-muted-foreground">Al menos 10 caracteres.</p>
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending}>{pending ? "Un momento…" : "Guardar contraseña"}</Button>
    </form>
  );
}
