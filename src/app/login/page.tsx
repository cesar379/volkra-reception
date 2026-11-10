import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Building2, Car } from "lucide-react";
import { demoLoginEnabled, getSession } from "@/server/auth";
import { features } from "@/server/env";
import { DEMO_USERS } from "@/server/db/seed";
import { demoLogin } from "./actions";
import { EmailForm } from "./forms";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if (await getSession()) redirect("/panel");
  const demo = demoLoginEnabled();
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <Image src="/brand/volkra-logo.png" alt="Volkra" width={168} height={36} className="brightness-0 invert" priority />
        <div className="max-w-md">
          <p className="mb-3 text-sm uppercase tracking-widest text-primary-foreground/70">Volkra Hub</p>
          <h1 className="text-4xl font-medium leading-tight">Herramientas con IA para tu negocio.</h1>
          <p className="mt-4 text-primary-foreground/80">Empieza con Reception: atiende llamadas, WhatsApp y el chat de tu web, y gestiona las citas por ti.</p>
        </div>
        <span />
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden">
            <Image src="/brand/volkra-logo.png" alt="Volkra" width={150} height={32} priority />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-2xl font-medium">Entrar</h2>
          </div>

          {sp.aviso === "enlace" ? (
            <p className="text-sm text-destructive" role="alert">El enlace no es válido o ha caducado. Pide otro con «¿Has olvidado tu contraseña?».</p>
          ) : null}

          {features.supabaseAuth ? <EmailForm /> : null}

          {demo ? (
            <div className="space-y-3">
              {features.supabaseAuth ? <div className="text-center text-xs uppercase tracking-widest text-muted-foreground">o prueba la demo</div> : null}
              {[
                { u: DEMO_USERS.clinic, icon: Building2, hint: "Demo" },
                { u: DEMO_USERS.garage, icon: Car, hint: "Demo" },
              ].map(({ u, icon: Icon, hint }) => (
                <form key={u.id} action={demoLogin}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button type="submit" className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-ring hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring">
                    <span className="grid size-10 place-items-center rounded-lg bg-secondary"><Icon className="size-5" /></span>
                    <span>
                      <span className="block text-sm font-medium">{u.label}</span>
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </button>
                </form>
              ))}
            </div>
          ) : null}

          {!features.supabaseAuth && !demo ? <p className="text-sm text-destructive">No hay ningún método de acceso configurado.</p> : null}

          <p className="flex gap-4 text-xs text-muted-foreground">
            <Link href="/privacidad" className="hover:text-foreground">Privacidad</Link>
            <Link href="/condiciones" className="hover:text-foreground">Condiciones</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
