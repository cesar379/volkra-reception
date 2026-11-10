import Link from "next/link";
import { requireApp } from "@/server/auth";
import { features } from "@/server/env";
import { getBusiness, listServices } from "@/server/booking/repo";
import { PageHeader } from "@/components/app/ui";
import { cn } from "@/lib/utils";
import { Simulator } from "./simulator";
import { VoiceCall } from "./voice-call";

export const metadata = { title: "Probar el asistente" };

export default async function SimulatorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireApp();
  const { business, services } = await ctx.asUser(async (q) => ({ business: (await getBusiness(q, ctx.business.id))!, services: await listServices(q, ctx.business.id) }));
  const firstService = services[0]?.name.toLowerCase() ?? "una cita";
  const hasVoice = Boolean(business.elevenlabs_agent_id);
  const mode = hasVoice && sp.modo !== "texto" ? "voz" : "texto";
  const tab = (m: "voz" | "texto", label: string) => (
    <Link href={`/simulador?modo=${m}`} className={cn("rounded-md px-3 py-1", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</Link>
  );
  return (
    <>
      <PageHeader
        title="Probar el asistente"
        actions={hasVoice ? <div className="inline-flex rounded-lg border bg-card p-0.5 text-sm">{tab("voz", "Voz")}{tab("texto", "Texto")}</div> : undefined}
      />
      {mode === "voz" ? (
        <div className="max-w-[420px]"><VoiceCall businessName={business.name} /></div>
      ) : (
        <Simulator
          mode={features.claude ? "claude" : "script"}
          model={business.voice_model}
          businessName={business.name}
          suggestions={[
            `Hola, quería ${firstService} mañana por la tarde`,
            "¿Qué horario tenéis?",
            "¿Tenéis aparcamiento?",
            "Quería cancelar mi cita",
            "Quiero hablar con una persona",
          ]}
        />
      )}
    </>
  );
}
