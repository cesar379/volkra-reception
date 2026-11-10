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
