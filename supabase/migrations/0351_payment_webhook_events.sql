-- Migration 0351: payment_webhook_events (the dedupe ledger of payment provider
-- deliveries)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL
--   client writes : BLOCKED
--
-- The event is inserted FIRST, before any other read: a primary key conflict means
-- the provider delivered it before. completed_at is stamped when the route answers
-- 200 for a handled event; a conflicting row with a null completed_at is an
-- in-flight or crashed earlier delivery and is processed again, which is safe
-- because every write behind it is idempotent on its own. The cron deletes rows
-- past 90 days. The provider is a column, per the naming rules; only Stripe writes
-- today.

create table if not exists public.payment_webhook_events (
  provider text not null check (provider in ('stripe')),
  event_id text not null check (length(event_id) <= 100),
  endpoint text not null check (endpoint in ('orders')),
  event_type text not null check (length(event_type) <= 80),
  livemode boolean,
  order_id uuid references public.orders(id) on delete set null,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text check (length(outcome) <= 80),
  primary key (provider, event_id)
);

create index if not exists idx_payment_webhook_events_received
  on public.payment_webhook_events (received_at);

alter table public.payment_webhook_events enable row level security;

drop policy if exists payment_webhook_events_service_role_all on public.payment_webhook_events;
create policy payment_webhook_events_service_role_all on public.payment_webhook_events
  for all to service_role using (true) with check (true);

comment on table public.payment_webhook_events is
  'Dedupe ledger of payment provider webhook deliveries. Service-role only; pruned past 90 days by the order-maintenance cron.';
