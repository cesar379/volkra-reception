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
