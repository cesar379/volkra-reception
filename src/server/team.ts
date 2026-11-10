import type { Queryable } from "./db/client";
import type { EmailMessage } from "./notify";

/**
 * Personas con acceso a un negocio. Las invitaciones se guardan por email: cuando alguien entra con
 * ese email (o crea su cuenta con él), recibe acceso automáticamente. Solo el servidor toca estas
 * tablas; quien llama ya ha comprobado que el usuario es «owner» del negocio.
 */
export type Role = "owner" | "staff";
export type TeamMember = { user_id: string; email: string | null; role: Role; created_at: Date };
export type Invite = { id: string; email: string; role: Role; created_at: Date };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function listTeam(q: Queryable, businessId: string): Promise<{ members: TeamMember[]; invites: Invite[] }> {
  const members = await q.query<TeamMember>(
    `select m.user_id, u.email, m.role, m.created_at from memberships m left join auth.users u on u.id = m.user_id
      where m.business_id = $1 order by m.created_at`,
    [businessId],
  );
  const invites = await q.query<Invite>(
    `select id, email, role, created_at from business_invites where business_id = $1 and accepted_at is null order by created_at`,
    [businessId],
  );
  return { members, invites };
}

export type InviteResult = { ok: true; added: "member" | "invite" } | { ok: false; error: string };

/** Si la persona ya tiene cuenta, recibe acceso al momento; si no, queda una invitación pendiente. */
export async function inviteMember(q: Queryable, p: { businessId: string; email: string; role: Role; invitedBy: string }): Promise<InviteResult> {
  const email = p.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "Email no válido." };
  const user = (await q.query<{ id: string }>(`select id from auth.users where lower(email) = $1 limit 1`, [email]))[0];
  if (user) {
    const r = await q.query(
      `insert into memberships (user_id, business_id, role) values ($1, $2, $3) on conflict do nothing returning user_id`,
      [user.id, p.businessId, p.role],
    );
    return r.length ? { ok: true, added: "member" } : { ok: false, error: "Esa persona ya tiene acceso." };
  }
  const r = await q.query(
    `insert into business_invites (business_id, email, role, invited_by) values ($1, $2, $3, $4) on conflict do nothing returning id`,
    [p.businessId, email, p.role, p.invitedBy],
  );
  return r.length ? { ok: true, added: "invite" } : { ok: false, error: "Ya hay una invitación pendiente para ese email." };
}

/** Al entrar: convierte en acceso las invitaciones pendientes para ese email. */
export async function claimInvites(q: Queryable, userId: string, email: string | null): Promise<number> {
  if (!email) return 0;
  const pending = await q.query<{ id: string; business_id: string; role: Role }>(
    `select id, business_id, role from business_invites where lower(email) = lower($1) and accepted_at is null`,
    [email],
  );
  for (const i of pending) {
    await q.query(`insert into memberships (user_id, business_id, role) values ($1, $2, $3) on conflict do nothing`, [userId, i.business_id, i.role]);
    await q.query(`update business_invites set accepted_at = now() where id = $1`, [i.id]);
  }
  return pending.length;
}

export async function revokeInvite(q: Queryable, businessId: string, inviteId: string) {
  await q.query(`delete from business_invites where id = $1 and business_id = $2 and accepted_at is null`, [inviteId, businessId]);
}

/** Quita el acceso. Nunca deja el negocio sin ningún «owner». */
export async function removeMember(q: Queryable, businessId: string, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const owners = await q.query<{ user_id: string }>(`select user_id from memberships where business_id = $1 and role = 'owner'`, [businessId]);
  if (owners.length === 1 && owners[0].user_id === userId) return { ok: false, error: "No puedes quitar al único administrador del negocio." };
  await q.query(`delete from memberships where business_id = $1 and user_id = $2`, [businessId, userId]);
  return { ok: true };
}

export function inviteEmail(p: { to: string; businessName: string; invitedBy: string | null; appUrl: string; role: Role }): EmailMessage {
  const who = p.invitedBy ? `${p.invitedBy} te ha dado` : "Te han dado";
  return {
    to: p.to,
    subject: `Acceso a ${p.businessName} en Volkra Hub`,
    text: [
      `${who} acceso a ${p.businessName} en Volkra Hub${p.role === "owner" ? " como administrador" : ""}.`,
      "",
      `Entra en ${p.appUrl.replace(/\/$/, "")}/login con este email (${p.to}). Si aún no tienes cuenta, créala con el mismo email.`,
      "",
      "Aviso automático de Volkra Hub.",
    ].join("\n"),
    replyTo: null,
  };
}

/** Exportación completa de los datos del negocio (portabilidad, art. 20 RGPD; y devolución al darse de baja). */
export async function exportBusiness(q: Queryable, businessId: string) {
  const one = async (sql: string) => q.query(sql, [businessId]);
  return {
    exported_at: new Date().toISOString(),
    business: (await one(`select * from businesses where id = $1`))[0] ?? null,
    business_hours: await one(`select weekday, opens, closes from business_hours where business_id = $1 order by weekday, opens`),
    special_days: await one(`select day, closed, hours, reason from special_days where business_id = $1 order by day`),
    staff: await one(`select id, name, role_title, active from staff where business_id = $1 order by name`),
    services: await one(`select id, name, description, duration_min, buffer_min, price_cents, price_from, active from services where business_id = $1 order by name`),
    faqs: await one(`select question, answer from faqs where business_id = $1`),
    customers: await one(`select id, name, phone, email, email_consent, created_at from customers where business_id = $1 order by created_at`),
    appointments: await one(
      `select id, service_id, staff_id, customer_id, starts_at, ends_at, status, source, booking_code, notes, cancelled_at, cancel_reason, created_at
         from appointments where business_id = $1 and not is_simulated order by starts_at`,
    ),
    calls: await one(
      `select id, provider, started_at, ended_at, duration_sec, caller_last4, status, outcome, summary from calls
        where business_id = $1 and not is_simulated order by started_at`,
    ),
    issues: await one(`select kind, message, created_at, resolved_at from issues where business_id = $1 order by created_at`),
  };
}

/** Baja definitiva: borra el negocio y, en cascada, todos sus datos (citas, clientes, llamadas, tokens…). */
export async function deleteBusiness(q: Queryable, businessId: string) {
  await q.query(`delete from businesses where id = $1`, [businessId]);
}
