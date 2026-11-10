-- Alertas internas para Volkra (no para los negocios): fallos en producción, saldo de la IA agotado…
-- Como mucho un email por tipo de alerta y hora; el resto se cuentan y se mencionan en el siguiente.
create table public.platform_alerts (
  key text primary key,
  last_sent_at timestamptz not null,
  suppressed int not null default 0
);
alter table public.platform_alerts enable row level security;
revoke all on public.platform_alerts from anon, authenticated;
