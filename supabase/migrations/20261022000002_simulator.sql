-- Conversaciones del simulador (modo demostración): se guardan en base de datos para que
-- funcionen igual en local y en despliegues serverless.
create table public.simulator_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  call_id uuid not null,
  mode text not null check (mode in ('claude', 'script')),
  messages jsonb not null default '[]'::jsonb,
  state jsonb not null default '{}'::jsonb,
  ended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (call_id, business_id) references public.calls (id, business_id) on delete cascade
);
create index on public.simulator_sessions (business_id, created_at desc);

alter table public.simulator_sessions enable row level security;
create policy simulator_sessions_member_all on public.simulator_sessions for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));
grant select, insert, update, delete on public.simulator_sessions to authenticated;
