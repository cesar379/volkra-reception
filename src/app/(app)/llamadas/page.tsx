import Link from "next/link";
import { PhoneCall, X } from "lucide-react";
import { requireApp } from "@/server/auth";
import { Empty, OutcomeBadge, PageHeader, SimTag } from "@/components/app/ui";
import { OUTCOME_LABEL, STATUS_LABEL, fmtDateTime, fmtDuration, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHANNEL: Record<string, string> = { vapi: "Teléfono", elevenlabs: "Teléfono", simulator: "Simulador", web: "Chat web", whatsapp: "WhatsApp" };

export const metadata = { title: "Llamadas" };

type CallRow = {
  id: string; started_at: Date; ended_at: Date | null; duration_sec: number | null; status: string; outcome: string | null;
  summary: string | null; is_simulated: boolean; needs_review: boolean; caller_last4: string | null; provider: string; ended_reason: string | null;
};
type EventRow = { at: Date; kind: string; name: string; detail: Record<string, unknown> };

const TOOL_LABEL: Record<string, string> = {
  buscar_huecos: "Buscó horas libres", reservar_cita: "Reservó cita", buscar_mis_citas: "Buscó las citas de la persona",
  cambiar_cita: "Cambió una cita", cancelar_cita: "Canceló una cita", consultar_informacion: "Consultó información",
  dejar_recado: "Dejó un recado", transferCall: "Transferencia a una persona",
};

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireApp();
  const outcome = sp.resultado && OUTCOME_LABEL[sp.resultado] ? sp.resultado : null;
  const includeSim = sp.simulados ? sp.simulados === "1" : ctx.business.is_demo;
  const page = Math.max(1, Number(sp.pagina) || 1);
  const PAGE = 40;

  const { rows, total, detail, events, appts } = await ctx.asUser(async (q) => {
    const where = [`business_id = $1`, includeSim ? "" : "not is_simulated", outcome ? `outcome = $2` : ""].filter(Boolean).join(" and ");
    const params: unknown[] = outcome ? [ctx.business.id, outcome] : [ctx.business.id];
    const rows = await q.query<CallRow>(
      `select id, started_at, ended_at, duration_sec, status, outcome, summary, is_simulated, needs_review, caller_last4, provider, ended_reason
         from calls where ${where} order by started_at desc limit ${PAGE} offset ${(page - 1) * PAGE}`,
      params,
    );
    const [{ n }] = await q.query<{ n: number }>(`select count(*)::int n from calls where ${where}`, params);
    let detail: CallRow | null = null;
    let events: EventRow[] = [];
    let appts: { booking_code: string; starts_at: Date; service_name: string; status: string }[] = [];
    if (sp.llamada && /^[0-9a-f-]{36}$/i.test(sp.llamada)) {
      detail = (await q.query<CallRow>(
        `select id, started_at, ended_at, duration_sec, status, outcome, summary, is_simulated, needs_review, caller_last4, provider, ended_reason
           from calls where business_id = $1 and id = $2`, [ctx.business.id, sp.llamada]))[0] ?? null;
      if (detail) {
        events = await q.query<EventRow>(`select at, kind, name, detail from call_events where call_id = $1 order by at`, [detail.id]);
        appts = await q.query(`select a.booking_code, a.starts_at, s.name as service_name, a.status from appointments a join services s on s.id = a.service_id where a.call_id = $1`, [detail.id]);
      }
    }
    return { rows, total: n, detail, events, appts };
  });

  const qs = (o: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { resultado: outcome, simulados: includeSim ? "1" : "0", ...o };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/llamadas?${p}`;
  };

  return (
    <>
      <PageHeader
        title="Llamadas"
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href={qs({ resultado: null, pagina: null })} className={cn("rounded-full border px-3 py-1 text-xs", !outcome ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>Todas</Link>
        {Object.entries(OUTCOME_LABEL).map(([k, label]) => (
          <Link key={k} href={qs({ resultado: k, pagina: null })} className={cn("rounded-full border px-3 py-1 text-xs", outcome === k ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>{label}</Link>
        ))}
        <Link href={qs({ simulados: includeSim ? "0" : "1", pagina: null })} className="ml-auto rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground hover:bg-muted">
          {includeSim ? "Ocultar simuladas" : "Mostrar simuladas"}
        </Link>
      </div>

      <div className={cn("grid gap-6", detail && "xl:grid-cols-[1fr_400px]")}>
        <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
          {rows.length === 0 ? (
            <div className="p-6"><Empty icon={<PhoneCall className="size-6" />} title="No hay llamadas con este filtro">Las llamadas aparecerán aquí en cuanto el asistente empiece a atender.</Empty></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr><th className="px-4 py-2.5 font-medium">Fecha</th><th className="px-4 py-2.5 font-medium">Resultado</th><th className="px-4 py-2.5 font-medium">Resumen</th><th className="px-4 py-2.5 text-right font-medium">Duración</th></tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((c) => (
                    <tr key={c.id} className={cn("hover:bg-muted/30", detail?.id === c.id && "bg-accent/40")}>
                      <td className="whitespace-nowrap px-4 py-3 tabular"><Link href={qs({ llamada: c.id, pagina: String(page) })} className="block">{fmtDateTime(c.started_at)}</Link></td>
                      <td className="px-4 py-3"><Link href={qs({ llamada: c.id, pagina: String(page) })} className="flex items-center gap-2"><OutcomeBadge outcome={c.outcome} status={c.status} />{c.is_simulated ? <SimTag /> : null}{c.needs_review ? <span className="size-2 rounded-full bg-warning" title="Para revisar" /> : null}</Link></td>
                      <td className="max-w-[28rem] truncate px-4 py-3 text-muted-foreground"><Link href={qs({ llamada: c.id, pagina: String(page) })} className="block truncate">{c.summary ?? "—"}</Link></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular text-muted-foreground">{fmtDuration(c.duration_sec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > PAGE ? (
            <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground">
              <span>{total} llamadas</span>
              <span className="flex gap-3">
                {page > 1 ? <Link href={qs({ pagina: String(page - 1) })} className="underline">Anteriores</Link> : null}
                {page * PAGE < total ? <Link href={qs({ pagina: String(page + 1) })} className="underline">Siguientes</Link> : null}
              </span>
            </div>
          ) : null}
        </div>

        {detail ? (
          <aside className="h-fit rounded-xl border bg-card xl:sticky xl:top-6">
            <div className="flex items-start justify-between border-b px-5 py-4">
              <div>
                <div className="text-base font-medium">{fmtDateTime(detail.started_at)}</div>
                <div className="mt-1 flex items-center gap-2"><OutcomeBadge outcome={detail.outcome} status={detail.status} />{detail.is_simulated ? <SimTag /> : null}</div>
              </div>
              <Link href={qs({ llamada: null, pagina: String(page) })} className="rounded-md p-1 hover:bg-muted" aria-label="Cerrar detalle"><X className="size-4" /></Link>
            </div>
            <div className="space-y-5 p-5 text-sm">
              <dl className="grid grid-cols-[120px_1fr] gap-y-1.5">
                <dt className="text-muted-foreground">Estado</dt><dd>{STATUS_LABEL[detail.status] ?? detail.status}</dd>
                <dt className="text-muted-foreground">Duración</dt><dd>{fmtDuration(detail.duration_sec)}</dd>
                <dt className="text-muted-foreground">Llamante</dt><dd className="tabular">{detail.caller_last4 ? `··· ${detail.caller_last4}` : "Oculto"}</dd>
                <dt className="text-muted-foreground">Canal</dt><dd>{CHANNEL[detail.provider] ?? detail.provider}</dd>
                {detail.ended_reason ? <><dt className="text-muted-foreground">Fin</dt><dd>{detail.ended_reason}</dd></> : null}
              </dl>
              <div>
                <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Resumen</div>
                <p>{detail.summary ?? "Sin resumen (el negocio no guarda resúmenes o la llamada sigue en curso)."}</p>
              </div>
              {appts.length ? (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Citas de esta llamada</div>
                  <ul className="grid gap-1">{appts.map((a) => <li key={a.booking_code}>{a.service_name} · {fmtDateTime(a.starts_at)} · <span className="font-mono text-xs">{a.booking_code}</span>{a.status === "cancelled" ? " (cancelada)" : ""}</li>)}</ul>
                </div>
              ) : null}
              <div>
                <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Qué hizo el asistente</div>
                {events.length === 0 ? <p className="text-muted-foreground">Sin acciones registradas.</p> : (
                  <ol className="relative grid gap-3 border-l pl-4">
                    {events.filter((e) => e.kind !== "tool_call").map((e, i) => (
                      <li key={i} className="relative">
                        <span className={cn("absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-card", e.kind === "error" ? "bg-destructive" : e.detail?.ok === false ? "bg-warning" : "bg-success")} />
                        <div className="text-xs text-muted-foreground tabular">{fmtTime(e.at)}</div>
                        <div>{TOOL_LABEL[e.name] ?? e.name}{typeof e.detail?.resumen === "string" ? <span className="text-muted-foreground"> · {e.detail.resumen}</span> : null}</div>
                        {e.kind === "error" ? <div className="text-xs text-destructive">Error técnico</div> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </>
  );
}
