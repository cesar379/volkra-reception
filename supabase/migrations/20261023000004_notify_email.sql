-- Email del negocio para avisos internos (recados y llamadas fallidas). Vacío = no se envía nada.
alter table public.businesses add column notify_email text
  check (notify_email is null or notify_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
