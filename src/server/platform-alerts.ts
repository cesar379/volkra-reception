import type { Queryable } from "./db/client";
import { env, features } from "./env";
import { resendSend, type EmailMessage } from "./notify";

/**
 * Alertas para Volkra (ALERT_EMAIL), no para los negocios: errores en producción, saldo de la IA
 * agotado y un resumen diario de fallos. Como mucho un email por tipo de alerta y hora; los que se
 * saltan se cuentan y se mencionan en el siguiente. Nunca lanza: una alerta que falla no rompe nada.
 */
type Opts = { to?: string | null; now?: Date; send?: (m: EmailMessage) => Promise<void> };

export async function platformAlert(q: Queryable, a: { key: string; subject: string; text: string }, opts: Opts = {}): Promise<"sent" | "throttled" | "disabled" | "failed"> {
  const to = opts.to !== undefined ? opts.to : env.ALERT_EMAIL;
  const send = opts.send ?? (features.email ? resendSend : null);
  if (!to || !send) return "disabled";
  const now = opts.now ?? new Date();
  try {
    const prev = (await q.query<{ last_sent_at: Date; suppressed: number }>(`select last_sent_at, suppressed from platform_alerts where key = $1`, [a.key]))[0];
    if (prev && now.getTime() - new Date(prev.last_sent_at).getTime() < 3600_000) {
      await q.query(`update platform_alerts set suppressed = suppressed + 1 where key = $1`, [a.key]);
      return "throttled";
    }
    await q.query(
      `insert into platform_alerts (key, last_sent_at, suppressed) values ($1, $2, 0)
       on conflict (key) do update set last_sent_at = excluded.last_sent_at, suppressed = 0`,
      [a.key, now],
    );
    const extra = prev?.suppressed ? `\n\n(Además, ${prev.suppressed} aviso${prev.suppressed === 1 ? "" : "s"} igual${prev.suppressed === 1 ? "" : "es"} desde el anterior.)` : "";
    await send({ to, subject: `[Volkra] ${a.subject}`, text: `${a.text}${extra}\n\nPanel: ${env.APP_URL.replace(/\/$/, "")}\nAlerta automática de Volkra Hub.`, replyTo: null });
    return "sent";
  } catch (err) {
    console.error("[alerta]", a.key, (err as Error).message);
    return "failed";
  }
}

/** Error no controlado en una petición (instrumentation.ts → onRequestError). */
export function requestErrorAlert(err: unknown, path: string, routePath: string, routeType: string) {
  const e = err instanceof Error ? err : new Error(String(err));
  return {
    key: `error:${routePath}:${e.message.slice(0, 80)}`,
    subject: `Error en ${routePath}`,
    text: [`Error no controlado en producción.`, "", `Ruta: ${routePath} (${routeType})`, `Petición: ${path.split("?")[0]}`, `Error: ${e.message}`, "", (e.stack ?? "").split("\n").slice(0, 6).join("\n")].join("\n"),
  };
}

/** Errores de Next.js que son control de flujo (redirect, notFound…), no fallos. */
export function isControlFlowError(err: unknown) {
  const digest = (err as { digest?: unknown })?.digest;
  return typeof digest === "string" && /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE)/.test(digest);
}

/** Resumen de las últimas 24 h para Volkra: incidencias de fallo por negocio y recordatorios fallidos. Nada que contar = no se envía. */
export async function dailyDigest(q: Queryable, now: Date, extra: { remindersFailed: number }): Promise<{ key: string; subject: string; text: string } | null> {
  const since = new Date(now.getTime() - 24 * 3600_000);
  const rows = await q.query<{ business: string; kind: string; n: number; last: string }>(
    `select b.name as business, i.kind, count(*)::int as n, max(i.message) as last
       from issues i join businesses b on b.id = i.business_id
      where i.created_at > $1 and i.kind in ('tool_error', 'call_failed', 'calendar_sync') and not b.is_demo
      group by b.name, i.kind order by n desc`,
    [since],
  );
  if (rows.length === 0 && extra.remindersFailed === 0) return null;
  const label: Record<string, string> = { tool_error: "Errores del asistente", call_failed: "Llamadas fallidas", calendar_sync: "Fallos con Google Calendar" };
  const lines = rows.map((r) => `- ${r.business}: ${label[r.kind] ?? r.kind} × ${r.n}. Último: ${r.last.slice(0, 160)}`);
  if (extra.remindersFailed) lines.push(`- Recordatorios por email que no se pudieron enviar: ${extra.remindersFailed}`);
  return {
    key: `digest:${now.toISOString().slice(0, 10)}`,
    subject: `Resumen de fallos de las últimas 24 h (${rows.reduce((s, r) => s + r.n, 0) + extra.remindersFailed})`,
    text: ["Fallos de las últimas 24 horas en negocios reales (sin las demos):", "", ...lines, "", "Detalle en «Para revisar» de cada negocio."].join("\n"),
  };
}

/** Saldo de Anthropic agotado o clave inválida: el asistente deja de responder en chat y WhatsApp. */
export function isAnthropicAccountError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return /credit balance|billing|insufficient|invalid x-api-key|authentication_error|permission_error/i.test(msg);
}
