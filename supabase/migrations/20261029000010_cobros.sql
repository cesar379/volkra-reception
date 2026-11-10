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
