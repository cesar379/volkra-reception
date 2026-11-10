import Image from "next/image";
import Link from "next/link";
import { requireSession } from "@/server/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { SubmitButton } from "@/components/app/submit-button";
import { VERTICALS } from "@/lib/format";
import { createBusiness } from "./actions";

export const metadata = { title: "Nuevo negocio" };

export default async function NewBusinessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireSession();
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <Image src="/brand/volkra-logo.png" alt="Volkra" width={140} height={30} />
        <div className="space-y-1.5">
          <h1 className="text-2xl font-medium">Añadir un negocio</h1>
          <p className="text-sm text-muted-foreground">Creamos una configuración de partida según el sector. Después ajustas horario, servicios y equipo.</p>
        </div>
        <form action={createBusiness} className="grid gap-4 rounded-xl border bg-card p-5">
          <div className="grid gap-1.5"><Label htmlFor="name">Nombre del negocio</Label><Input id="name" name="name" required minLength={2} placeholder="Clínica Ejemplo" /></div>
          <div className="grid gap-1.5">
            <Label htmlFor="vertical">Sector</Label>
            <NativeSelect id="vertical" name="vertical" defaultValue="clinica">{Object.entries(VERTICALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
          </div>
          {sp.error ? <p className="text-sm text-destructive">Escribe un nombre de al menos 2 letras.</p> : null}
          <SubmitButton size="lg">Crear negocio</SubmitButton>
        </form>
        <Link href="/panel" className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline">Volver</Link>
      </div>
    </main>
  );
}
