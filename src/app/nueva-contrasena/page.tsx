import Image from "next/image";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { NewPasswordForm } from "../login/forms";

export const metadata = { title: "Nueva contraseña" };

/** Se llega desde el enlace del email de recuperación, que ya ha abierto la sesión. */
export default async function NewPasswordPage() {
  const session = await getSession();
  if (!session || session.mode !== "supabase") redirect("/login?aviso=enlace");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-8">
        <Image src="/brand/volkra-logo.png" alt="Volkra" width={150} height={32} priority />
        <div className="space-y-1.5">
          <h1 className="text-2xl font-medium">Elige una contraseña nueva</h1>
          {session.email ? <p className="text-sm text-muted-foreground">Para {session.email}</p> : null}
        </div>
        <NewPasswordForm />
      </div>
    </main>
  );
}
