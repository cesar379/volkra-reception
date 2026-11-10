import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requireApp } from "@/server/auth";
import { Empty, PageHeader } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";
import { resolveIssue } from "./actions";

export const metadata = { title: "Para revisar" };

const KIND: Record<string, { label: string; hint: string }> = {
  callback_request: { label: "Recado: devolver llamada", hint: "Una persona pidió que la llamen." },
  unknown_question: { label: "Pregunta sin respuesta", hint: "Añade la respuesta en Configuración → Preguntas frecuentes." },
  tool_error: { label: "Error técnico", hint: "El asistente no pudo completar una acción." },
  calendar_sync: { label: "Google Calendar", hint: "La cita está guardada; falló la sincronización." },
  call_failed: { label: "Llamada fallida", hint: "La llamada terminó por un problema técnico." },
  other: { label: "Otro", hint: "" },
};

export default async function IssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireApp();
  const showResolved = sp.resueltas === "1";
  const rows = await ctx.asUser((q) =>
    q.query<{ id: string; kind: string; message: string; created_at: Date; resolved_at: Date | null; call_id: string | null }>(
      `select id, kind, message, created_at, resolved_at, call_id from issues
        where business_id = $1 and ${showResolved ? "resolved_at is not null" : "resolved_at is null"}
        order by created_at desc limit 100`,
      [ctx.business.id],
    ),
  );
  return (
    <>
      <PageHeader
        title="Para revisar"
        actions={<Link href={showResolved ? "/incidencias" : "/incidencias?resueltas=1"} className="text-sm text-muted-foreground underline-offset-4 hover:underline">{showResolved ? "Ver pendientes" : "Ver resueltas"}</Link>}
      />
      {rows.length === 0 ? (
        <Empty icon={<CheckCircle2 className="size-6" />} title={showResolved ? "Nada resuelto todavía" : "Todo al día"}>
          {showResolved ? "" : "No hay nada pendiente de revisar."}
        </Empty>
      ) : (
        <ul className="grid gap-3">
          {rows.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start gap-4 rounded-xl border bg-card p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-warning/12 px-2 py-0.5 font-medium text-warning">{KIND[i.kind]?.label ?? i.kind}</span>
                  <span className="text-muted-foreground tabular">{fmtDateTime(i.created_at)}</span>
                  {i.call_id ? <Link href={`/llamadas?llamada=${i.call_id}`} className="text-muted-foreground underline-offset-4 hover:underline">Ver llamada</Link> : null}
                </div>
                <p className="text-sm">{i.message}</p>
                {KIND[i.kind]?.hint ? <p className="text-xs text-muted-foreground">{KIND[i.kind].hint}</p> : null}
              </div>
              {!i.resolved_at ? (
                <form action={resolveIssue}>
                  <input type="hidden" name="id" value={i.id} />
                  <Button variant="outline" size="sm" type="submit"><CheckCircle2 /> Marcar como resuelta</Button>
                </form>
              ) : <span className="text-xs text-muted-foreground">Resuelta {fmtDateTime(i.resolved_at)}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
