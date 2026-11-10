-- Volkra Recepción · esquema completo para el SQL Editor de Supabase (generado; no editar a mano)

-- ===== 20261022000001_schema.sql =====
-- Volkra Recepción · esquema principal
-- Multiempresa: todas las tablas de negocio llevan business_id y están protegidas por RLS.
-- Compatible con Supabase (auth.uid(), rol "authenticated") y con PGlite en local (ver supabase/local/shim.sql).

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Empresas y miembros
-- ---------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  vertical text not null default 'otro',          -- clinica, peluqueria, taller, academia, otro
  description text not null default '',
  address text not null default '',
  public_phone text not null default '',
  timezone text not null default 'Europe/Madrid',
  -- Agente
  agent_name text not null default 'Lucía',
  welcome_message text not null default '',
  ai_instructions text not null default '',
  agent_phone_number text unique,                  -- número E.164 que atiende el agente
  vapi_phone_number_id text unique,                -- id del número en Vapi
  transfer_number text,                            -- número E.164 al que transferir
  voice_model text not null default 'claude-sonnet-5',
  voice_id text not null default 'es-ES-ElviraNeural',
  -- Reglas de agenda
  slot_interval_min int not null default 15 check (slot_interval_min in (5, 10, 15, 20, 30, 60)),
  min_notice_min int not null default 60 check (min_notice_min >= 0),
  max_days_ahead int not null default 60 check (max_days_ahead between 1 and 365),
  -- Métricas estimadas (configurables y siempre marcadas como estimación)
  minutes_saved_per_call numeric(5,1) not null default 4 check (minutes_saved_per_call >= 0),
  -- Privacidad
  store_call_summaries boolean not null default true,
  recording_enabled boolean not null default false,
  -- Google Calendar
  google_calendar_id text,
  google_connected boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);

-- ¿El usuario actual pertenece a la empresa? security definer para no depender de RLS de memberships.
create or replace function public.is_member(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.business_id = bid and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Horarios, cierres y festivos
-- ---------------------------------------------------------------------------
-- weekday: 1 = lunes … 7 = domingo (ISO). Varias franjas por día (jornada partida).
create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  opens time not null,
  closes time not null,
  check (closes > opens)
);
create index on public.business_hours (business_id, weekday);

-- Día especial: cerrado (festivo) u horario distinto (hours = [{"opens":"10:00","closes":"14:00"}]).
create table public.special_days (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  day date not null,
  closed boolean not null default true,
  hours jsonb not null default '[]'::jsonb,
  reason text not null default '',
  unique (business_id, day)
);

-- ---------------------------------------------------------------------------
-- Equipo y servicios
-- ---------------------------------------------------------------------------
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  role_title text not null default '',
  color text not null default '#4A5D5E',
  active boolean not null default true,
  google_calendar_id text,
  created_at timestamptz not null default now(),
  unique (id, business_id)
);

-- Si un profesional no tiene filas aquí, trabaja en el horario del negocio.
create table public.staff_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  opens time not null,
  closes time not null,
  check (closes > opens),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);

create table public.staff_time_off (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '',
  check (ends_at > starts_at),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text not null default '',
  duration_min int not null check (duration_min between 5 and 480),
  buffer_min int not null default 0 check (buffer_min between 0 and 120),
  price_cents int check (price_cents >= 0),        -- null = precio a consultar
  price_from boolean not null default false,       -- "desde X €"
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, business_id)
);

create table public.staff_services (
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid not null,
  service_id uuid not null,
  primary key (staff_id, service_id),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  foreign key (service_id, business_id) references public.services (id, business_id) on delete cascade
);

create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  question text not null,
  answer text not null,
  position int not null default 0
);

-- ---------------------------------------------------------------------------
-- Clientes y citas
-- ---------------------------------------------------------------------------
-- Minimización: solo nombre y teléfono (necesarios para la cita). Email solo con consentimiento.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text,                                     -- E.164
  email text,
  email_consent boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  unique (business_id, phone)
);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null check (provider in ('vapi', 'simulator')),
  provider_call_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_sec int,
  caller_last4 text,                              -- solo para mostrar; nunca el número completo
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'transferred', 'failed')),
  outcome text check (outcome in ('booked', 'rescheduled', 'cancelled', 'info', 'transferred', 'message', 'no_action', 'error')),
  ended_reason text,
  summary text,
  is_simulated boolean not null default false,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  unique (provider, provider_call_id),
  unique (id, business_id)
);
create index on public.calls (business_id, started_at desc);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  service_id uuid not null,
  staff_id uuid not null,
  customer_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'completed', 'no_show')),
  source text not null default 'manual' check (source in ('ai_call', 'manual', 'simulator')),
  booking_code text not null,
  notes text not null default '',
  call_id uuid references public.calls(id) on delete set null,
  idempotency_key text,
  is_simulated boolean not null default false,
  cancelled_at timestamptz,
  cancel_reason text,
  gcal_event_id text,
  gcal_sync_status text not null default 'not_configured' check (gcal_sync_status in ('not_configured', 'pending', 'synced', 'failed')),
  gcal_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (service_id, business_id) references public.services (id, business_id),
  foreign key (staff_id, business_id) references public.staff (id, business_id),
  foreign key (customer_id, business_id) references public.customers (id, business_id),
  unique (business_id, booking_code),
  unique (business_id, idempotency_key),
  -- Control de concurrencia: un profesional no puede tener dos citas confirmadas que se solapen,
  -- aunque lleguen dos llamadas a la vez. La base de datos lo garantiza (error 23P01).
  constraint appointments_no_overlap exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'confirmed')
);
create index on public.appointments (business_id, starts_at);

create table public.call_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  call_id uuid not null,
  at timestamptz not null default now(),
  kind text not null check (kind in ('tool_call', 'tool_result', 'transfer', 'error', 'message')),
  name text not null default '',
  detail jsonb not null default '{}'::jsonb,
  foreign key (call_id, business_id) references public.calls (id, business_id) on delete cascade
);
create index on public.call_events (call_id, at);

-- Incidencias que una persona debe revisar (errores, recados, sincronizaciones fallidas…)
create table public.issues (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('calendar_sync', 'tool_error', 'callback_request', 'unknown_question', 'call_failed', 'other')),
  message text not null,
  call_id uuid references public.calls(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index on public.issues (business_id, resolved_at, created_at desc);

-- ---------------------------------------------------------------------------
-- Tablas internas (sin acceso desde el navegador: RLS activado y sin políticas)
-- ---------------------------------------------------------------------------
create table public.webhook_events (
  provider text not null,
  event_key text not null,
  business_id uuid references public.businesses(id) on delete cascade,
  response jsonb,
  received_at timestamptz not null default now(),
  primary key (provider, event_key)
);

create table public.google_credentials (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  refresh_token_enc text not null,                -- cifrado AES-256-GCM con ENCRYPTION_KEY
  account_email text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.businesses enable row level security;
alter table public.memberships enable row level security;
alter table public.business_hours enable row level security;
alter table public.special_days enable row level security;
alter table public.staff enable row level security;
alter table public.staff_hours enable row level security;
alter table public.staff_time_off enable row level security;
alter table public.services enable row level security;
alter table public.staff_services enable row level security;
alter table public.faqs enable row level security;
alter table public.customers enable row level security;
alter table public.calls enable row level security;
alter table public.appointments enable row level security;
alter table public.call_events enable row level security;
alter table public.issues enable row level security;
alter table public.webhook_events enable row level security;
alter table public.google_credentials enable row level security;

create policy businesses_member_select on public.businesses for select to authenticated using (public.is_member(id));
create policy businesses_member_update on public.businesses for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

create policy memberships_self on public.memberships for select to authenticated using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['business_hours','special_days','staff','staff_hours','staff_time_off','services',
                           'staff_services','faqs','customers','calls','appointments','call_events','issues']
  loop
    execute format('create policy %I on public.%I for all to authenticated using (public.is_member(business_id)) with check (public.is_member(business_id))',
                   t || '_member_all', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.webhook_events, public.google_credentials from authenticated;
grant execute on function public.is_member(uuid) to authenticated;

-- Alta de empresa por un usuario autenticado: crea la empresa y le hace propietario.
create or replace function public.create_business(p_name text, p_vertical text default 'otro')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  insert into public.businesses (name, vertical) values (p_name, coalesce(p_vertical, 'otro')) returning id into new_id;
  insert into public.memberships (user_id, business_id, role) values (auth.uid(), new_id, 'owner');
  return new_id;
end;
$$;
grant execute on function public.create_business(text, text) to authenticated;

-- ===== 20261022000002_simulator.sql =====
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

-- ===== 20261022000003_elevenlabs.sql =====
-- Proveedor de voz alternativo: ElevenLabs Agents.
alter table public.businesses add column elevenlabs_agent_id text unique;

alter table public.calls drop constraint if exists calls_provider_check;
alter table public.calls add constraint calls_provider_check check (provider in ('vapi', 'simulator', 'elevenlabs'));

-- Teléfono de quien llama, CIFRADO y solo mientras dura la llamada (lo da la telefonía al iniciar).
-- Se borra al recibir el informe de fin de llamada. El historial solo guarda los 4 últimos dígitos.
alter table public.calls add column caller_phone_enc text;
-- No accesible para los usuarios: el privilegio de tabla incluiría todas las columnas,
-- así que se sustituye por privilegios columna a columna sin caller_phone_enc.
revoke select, insert, update on public.calls from authenticated;
grant select (id, business_id, provider, provider_call_id, started_at, ended_at, duration_sec, caller_last4, status,
              outcome, ended_reason, summary, is_simulated, needs_review, created_at) on public.calls to authenticated;

-- ===== 20261023000004_notify_email.sql =====
-- Email del negocio para avisos internos (recados y llamadas fallidas). Vacío = no se envía nada.
alter table public.businesses add column notify_email text
  check (notify_email is null or notify_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- ===== 20261023000005_revoke_anon.sql =====
-- Defensa en profundidad: el rol anónimo de Supabase no necesita ningún acceso a estas tablas
-- (la app accede por el servidor). RLS ya lo bloquea; además quitamos los permisos por defecto.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.create_business(text, text) to authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- ===== 20261023000006_fix_jsonb_strings.sql =====
-- Repara valores jsonb guardados como texto JSON (doble serialización del driver postgres.js,
-- corregida en src/server/db/client.ts). En bases sin el problema no cambia nada.
update public.call_events set detail = (detail #>> '{}')::jsonb where jsonb_typeof(detail) = 'string';
update public.special_days set hours = (hours #>> '{}')::jsonb where jsonb_typeof(hours) = 'string';
update public.webhook_events set response = (response #>> '{}')::jsonb where jsonb_typeof(response) = 'string';
update public.simulator_sessions set messages = (messages #>> '{}')::jsonb where jsonb_typeof(messages) = 'string';
update public.simulator_sessions set state = (state #>> '{}')::jsonb where jsonb_typeof(state) = 'string';

-- ===== 20261023000007_web_chat.sql =====
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

-- ===== 20261023000008_whatsapp.sql =====
-- WhatsApp Business (Cloud API de Meta): el mismo agente atendiendo por WhatsApp.
alter table public.businesses
  add column whatsapp_enabled boolean not null default false,
  add column whatsapp_phone_number_id text unique,   -- "Phone number ID" de Meta: identifica el negocio en el webhook
  add column whatsapp_display_phone text;            -- número visible, solo informativo

-- Token de acceso de Meta por negocio, cifrado (AES-256-GCM). Solo lo lee el servidor.
-- Sin fila, se usa WHATSAPP_ACCESS_TOKEN (cuando todos los números cuelgan de la cuenta de la plataforma).
create table public.whatsapp_credentials (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  access_token_enc text not null,
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_credentials enable row level security;
revoke all on public.whatsapp_credentials from anon, authenticated;

alter table public.calls drop constraint if exists calls_provider_check;
alter table public.calls add constraint calls_provider_check check (provider in ('vapi', 'simulator', 'elevenlabs', 'web', 'whatsapp'));

-- Las conversaciones de WhatsApp reutilizan chat_sessions. En WhatsApp, ip_hash guarda el hash del número.
alter table public.chat_sessions add column channel text not null default 'web' check (channel in ('web', 'whatsapp'));
create index on public.chat_sessions (business_id, channel, ip_hash, updated_at desc);

-- Meta reintenta los webhooks: cada mensaje entrante se procesa una sola vez.
create table public.whatsapp_inbound (
  wa_message_id text primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  received_at timestamptz not null default now()
);
alter table public.whatsapp_inbound enable row level security;
revoke all on public.whatsapp_inbound from anon, authenticated;

-- ===== 20261029000009_recordatorios_y_usuarios.sql =====
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

-- ===== 20261029000010_cobros.sql =====
-- Cobro a los negocios con Stripe (suscripción mensual). Solo lo escribe el servidor desde el webhook
-- de Stripe: sin acceso desde el navegador, para que nadie pueda marcarse como «pagado».
create table public.billing (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  status text not null default 'none' check (status in ('none', 'incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'canceled')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.billing enable row level security;
revoke all on public.billing from anon, authenticated;

-- ===== 20261101000011_alertas.sql =====
-- Alertas internas para Volkra (no para los negocios): fallos en producción, saldo de la IA agotado…
-- Como mucho un email por tipo de alerta y hora; el resto se cuentan y se mencionan en el siguiente.
create table public.platform_alerts (
  key text primary key,
  last_sent_at timestamptz not null,
  suppressed int not null default 0
);
alter table public.platform_alerts enable row level security;
revoke all on public.platform_alerts from anon, authenticated;

create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations(name) values ('20261022000001_schema.sql') on conflict do nothing;
insert into public._migrations(name) values ('20261022000002_simulator.sql') on conflict do nothing;
insert into public._migrations(name) values ('20261022000003_elevenlabs.sql') on conflict do nothing;
insert into public._migrations(name) values ('20261023000004_notify_email.sql') on conflict do nothing;
insert into public._migrations(name) values ('20261023000005_revoke_anon.sql') on conflict do nothing;
insert into public._migrations(name) values ('20261023000006_fix_jsonb_strings.sql') on conflict do nothing;
insert into public._migrations(name) values ('20261023000007_web_chat.sql') on conflict do nothing;
insert into public._migrations(name) values ('20261023000008_whatsapp.sql') on conflict do nothing;
insert into public._migrations(name) values ('20261029000009_recordatorios_y_usuarios.sql') on conflict do nothing;
insert into public._migrations(name) values ('20261029000010_cobros.sql') on conflict do nothing;
insert into public._migrations(name) values ('20261101000011_alertas.sql') on conflict do nothing;
select 'Volkra: esquema creado' as resultado;
