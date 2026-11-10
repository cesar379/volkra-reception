import type { Queryable } from "../db/client";

export type DashboardData = {
  days: number;
  includeSimulated: boolean;
  simulatedInPeriod: number;
  calls: { total: number; handledByAi: number; transferred: number; failed: number; avgDurationSec: number; totalMinutes: number; outOfHoursNote?: string };
  appointments: { booked: number; cancelled: number; rescheduled: number };
  minutesSavedPerCall: number;
  hoursSavedEstimate: number;
  perDay: { day: string; booked: number; info: number; transferred: number; other: number }[];
  openIssues: { id: string; kind: string; message: string; created_at: Date }[];
  openIssuesCount: number;
  recentCalls: { id: string; started_at: Date; duration_sec: number | null; outcome: string | null; status: string; summary: string | null; is_simulated: boolean; caller_last4: string | null }[];
};

/** Métricas calculadas sobre los registros reales de la base de datos (con RLS del usuario). */
export async function getDashboard(q: Queryable, businessId: string, days: number, includeSimulated: boolean, tz: string): Promise<DashboardData> {
  const since = new Date(Date.now() - days * 86400_000);
  const sim = includeSimulated ? "" : "and not is_simulated";
  const [c] = await q.query<{ total: number; ai: number; transferred: number; failed: number; avg: number | null; total_sec: number | null; sim: number }>(
    `select count(*)::int as total,
            count(*) filter (where status = 'completed')::int as ai,
            count(*) filter (where status = 'transferred' or outcome = 'transferred')::int as transferred,
            count(*) filter (where status = 'failed')::int as failed,
            avg(duration_sec)::float8 as avg,
            sum(duration_sec)::float8 as total_sec,
            (select count(*)::int from calls where business_id = $1 and started_at >= $2 and is_simulated) as sim
       from calls where business_id = $1 and started_at >= $2 ${sim}`,
    [businessId, since],
  );
  const [a] = await q.query<{ cancelled: number }>(
    `select count(*) filter (where cancelled_at >= $2)::int as cancelled
       from appointments where business_id = $1 ${sim}`,
    [businessId, since],
  );
  // Citas reservadas por el asistente: por llamada con resultado "booked" (incluye las ya pasadas)
  const [booked] = await q.query<{ n: number; r: number }>(
    `select count(*) filter (where outcome = 'booked')::int as n, count(*) filter (where outcome = 'rescheduled')::int as r
       from calls where business_id = $1 and started_at >= $2 ${sim}`,
    [businessId, since],
  );
  const [biz] = await q.query<{ m: number }>(`select minutes_saved_per_call::float8 as m from businesses where id = $1`, [businessId]);
  const perDay = await q.query<{ day: string; booked: number; info: number; transferred: number; other: number }>(
    `select to_char(d, 'YYYY-MM-DD') as day,
            count(c.id) filter (where c.outcome in ('booked', 'rescheduled', 'cancelled'))::int as booked,
            count(c.id) filter (where c.outcome = 'info')::int as info,
            count(c.id) filter (where c.outcome = 'transferred' or c.status = 'transferred')::int as transferred,
            count(c.id) filter (where coalesce(c.outcome, 'no_action') in ('message', 'no_action', 'error') and c.status <> 'transferred')::int as other
       from generate_series((now() at time zone $2)::date - ($3::int - 1), (now() at time zone $2)::date, interval '1 day') d
       left join calls c on c.business_id = $1 and (c.started_at at time zone $2)::date = d::date ${includeSimulated ? "" : "and not c.is_simulated"}
      group by d order by d`,
    [businessId, tz, days],
  );
  const openIssues = await q.query<DashboardData["openIssues"][number]>(
    `select id, kind, message, created_at from issues where business_id = $1 and resolved_at is null order by created_at desc limit 5`,
    [businessId],
  );
  const [{ n: openIssuesCount }] = await q.query<{ n: number }>(`select count(*)::int n from issues where business_id = $1 and resolved_at is null`, [businessId]);
  const recentCalls = await q.query<DashboardData["recentCalls"][number]>(
    `select id, started_at, duration_sec, outcome, status, summary, is_simulated, caller_last4
       from calls where business_id = $1 ${sim} order by started_at desc limit 6`,
    [businessId],
  );
  const minutesSaved = biz?.m ?? 0;
  return {
    days,
    includeSimulated,
    simulatedInPeriod: c.sim,
    calls: { total: c.total, handledByAi: c.ai, transferred: c.transferred, failed: c.failed, avgDurationSec: Math.round(c.avg ?? 0), totalMinutes: Math.round((c.total_sec ?? 0) / 60) },
    appointments: { booked: booked.n, cancelled: a.cancelled, rescheduled: booked.r },
    minutesSavedPerCall: minutesSaved,
    hoursSavedEstimate: Math.round(((c.ai * minutesSaved) / 60) * 10) / 10,
    perDay,
    openIssues,
    openIssuesCount,
    recentCalls,
  };
}
