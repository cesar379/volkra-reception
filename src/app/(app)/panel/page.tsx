import Link from "next/link";
import { CheckCircle2, Circle, PhoneCall, TriangleAlert } from "lucide-react";
import { requireApp } from "@/server/auth";
import { getDashboard } from "@/server/queries/dashboard";
import { getBusiness } from "@/server/booking/repo";
import { Empty, OutcomeBadge, PageHeader, Section, SimTag, Stat } from "@/components/app/ui";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CallsChart } from "./calls-chart";
import { getOnboarding } from "@/server/onboarding";

export const metadata = { title: "Panel" };

export default async function PanelPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireApp();
  const days = sp.dias === "30" ? 30 : 7;
  const business = await ctx.asUser((q) => getBusiness(q, ctx.business.id));
  const includeSim = sp.simulados ? sp.simulados === "1" : ctx.business.is_demo;
  const d = await ctx.asUser((q) => getDashboard(q, ctx.business.id, days, includeSim, business!.timezone));
  const link = (o: Record<string, string>) => `/panel?${new URLSearchParams({ dias: String(days), simulados: includeSim ? "1" : "0", ...o })}`;
  const steps = await ctx.asUser((q) => getOnboarding(q, business!));
  const required = steps.filter((s) => !s.optional);
  const pending = required.filter((s) => !s.done).length;
  const pct = (n: number) => (d.calls.total ? `${Math.round((n / d.calls.total) * 100)} % del total` : "—");

  return (
    <>
      <PageHeader
        title="Resumen"
        description={`Últimos ${days} días`}
        actions={
          <>
            <div className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
              {[7, 30].map((n) => (
                <Link key={n} href={link({ dias: String(n) })} className={cn("rounded-md px-3 py-1", days === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {n} días
                </Link>
              ))}
            </div>
            {d.simulatedInPeriod > 0 || includeSim ? (
              <Link href={link({ simulados: includeSim ? "0" : "1" })} className="rounded-lg border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
                {includeSim ? "Ocultar datos simulados" : "Mostrar datos simulados"}
              </Link>
            ) : null}
          </>
        }
      />

      {pending > 0 ? (
        <section className="mb-6 rounded-xl border bg-card p-5" aria-labelledby="puesta-en-marcha">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="puesta-en-marcha" className="text-base font-medium">Puesta en marcha</h2>
            <span className="text-sm text-muted-foreground">{required.length - pending} de {required.length} pasos</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.round(((required.length - pending) / required.length) * 100)}%` }} /></div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {steps.map((s) => (
              <li key={s.key}>
                <Link href={s.href} className={cn("flex h-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition hover:border-ring", s.done && "opacity-60")}>
                  {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  <span>
                    <span className="font-medium">{s.title}{s.optional ? <span className="font-normal text-muted-foreground"> · opcional</span> : null}</span>
                    {!s.done ? <span className="block text-muted-foreground">{s.hint}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {includeSim && d.simulatedInPeriod > 0 ? (
        <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <SimTag /> Incluye {d.simulatedInPeriod} llamadas simuladas de demostración.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Llamadas recibidas" value={d.calls.total} hint={d.calls.total ? `${d.calls.totalMinutes} min en total` : "Aún no hay llamadas"} />
        <Stat label="Atendidas por la IA" value={d.calls.handledByAi} hint={pct(d.calls.handledByAi)} />
        <Stat label="Transferidas a una persona" value={d.calls.transferred} hint={pct(d.calls.transferred)} />
        <Stat label="Duración media" value={`${Math.floor(d.calls.avgDurationSec / 60)}:${String(d.calls.avgDurationSec % 60).padStart(2, "0")}`} hint="minutos por llamada" />
        <Stat label="Citas reservadas" value={d.appointments.booked} hint={`${d.appointments.rescheduled} cambiadas`} />
        <Stat label="Citas canceladas" value={d.appointments.cancelled} hint="en el periodo" />
        <Stat
          label="Horas de recepción ahorradas"
          value={`≈ ${d.hoursSavedEstimate.toLocaleString("es-ES")} h`}
          hint={<span>Estimación: {d.minutesSavedPerCall} min por llamada atendida. <Link className="underline" href="/configuracion?tab=agente">Ajustar</Link></span>}
        />
        <Stat label="Para revisar" value={d.openIssuesCount} tone={d.openIssuesCount ? "warning" : undefined} hint={d.calls.failed ? `${d.calls.failed} ${d.calls.failed === 1 ? "llamada" : "llamadas"} con fallo` : "incidencias abiertas"} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Llamadas por día">
          {d.calls.total ? <CallsChart data={d.perDay} /> : <Empty icon={<PhoneCall className="size-6" />} title="Sin llamadas en este periodo">Cuando el asistente atienda llamadas, aparecerán aquí.</Empty>}
        </Section>

        <Section title="Para revisar" actions={<Link href="/incidencias" className="text-sm underline-offset-4 hover:underline">Ver todo</Link>}>
          {d.openIssues.length === 0 ? (
            <Empty icon={<TriangleAlert className="size-6" />} title="Nada pendiente">No hay incidencias abiertas.</Empty>
          ) : (
            <ul className="grid gap-3">
              {d.openIssues.map((i) => (
                <li key={i.id} className="rounded-lg border-l-2 border-warning bg-muted/40 px-3 py-2 text-sm">
                  <div>{i.message}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(i.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="mt-6">
        <Section title="Últimas llamadas" actions={<Link href="/llamadas" className="text-sm underline-offset-4 hover:underline">Historial completo</Link>}>
          {d.recentCalls.length === 0 ? (
            <Empty title="Todavía no hay llamadas">Prueba el asistente en «Probar el asistente» o conecta un número de teléfono.</Empty>
          ) : (
            <ul className="divide-y">
              {d.recentCalls.map((c) => (
                <li key={c.id}>
                  <Link href={`/llamadas?llamada=${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-muted/30">
                    <span className="w-32 shrink-0 text-sm tabular">{fmtDateTime(c.started_at)}</span>
                    <OutcomeBadge outcome={c.outcome} status={c.status} />
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{c.summary ?? "Sin resumen"}</span>
                    <span className="text-xs text-muted-foreground tabular">{fmtDuration(c.duration_sec)}</span>
                    {c.is_simulated ? <SimTag /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
