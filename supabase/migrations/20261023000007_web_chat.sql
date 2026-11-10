-- Chat web: el mismo agente (Claude + herramientas + agenda) atendiendo por escrito desde la web del negocio.
alter table public.businesses
  add column web_chat_enabled boolean not null default false,
  add column web_chat_key text unique;      -- identificador público del widget; se puede regenerar

alter table public.calls drop constraint if exists calls_provider_check;
alter table public.calls add constraint calls_provider_check check (provider in ('vapi', 'simulator', 'elevenlabs', 'web'));

-- Conversaciones del chat web. Solo las usa el servidor: sin acceso para usuarios del panel ni anónimos.
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  call_id uuid not null,
  messages jsonb not null default '[]'::jsonb,
  turns int not null default 0,
  actions int not null default 0,           -- reservas y recados hechos en esta conversación
  ip_hash text not null,
  ended boolean not null default false,
  busy_until timestamptz,                   -- evita dos turnos a la vez en la misma conversación
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (call_id, business_id) references public.calls (id, business_id) on delete cascade
);
create index on public.chat_sessions (ip_hash, created_at desc);
create index on public.chat_sessions (business_id, created_at desc);

alter table public.chat_sessions enable row level security;
revoke all on public.chat_sessions from anon, authenticated;
