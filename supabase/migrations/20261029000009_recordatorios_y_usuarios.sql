-- Recordatorio por email el día antes de la cita (solo a quien dio su email y aceptó recibirlo).
alter table public.businesses add column reminder_email boolean not null default true;
alter table public.appointments add column reminder_sent_at timestamptz;
create index appointments_reminder_idx on public.appointments (starts_at) where status = 'confirmed' and reminder_sent_at is null;

-- Invitaciones para dar acceso a más personas del equipo. Al entrar con ese email, la persona
-- recibe acceso al negocio. Solo las gestiona el servidor (sin acceso directo desde el navegador).
create table public.business_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role text not null default 'staff' check (role in ('owner', 'staff')),
  invited_by uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index business_invites_pending on public.business_invites (business_id, lower(email)) where accepted_at is null;
alter table public.business_invites enable row level security;
revoke all on public.business_invites from anon, authenticated;
create index business_invites_email on public.business_invites (lower(email)) where accepted_at is null;
