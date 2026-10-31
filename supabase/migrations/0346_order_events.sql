-- Migration 0346: order_events (the timeline of everything that happened to an
-- order, and where internal notes live)
--
-- Access matrix:
--   anon          : none
--   authenticated : SELECT rows on own orders where visible_to_customer is true
--   service_role  : ALL
--   client writes : BLOCKED
--
-- Internal notes are rows here with visible_to_customer = false, because the
-- orders row is readable in full by its owner (migration 0345). The dispute_*,
-- duplicate_payment and payment_mismatch kinds are written invisible too: a
-- chargeback is between the admin, Stripe and the card network, and a duplicate
-- payment reaches the customer as a refund email, not a timeline row.
--
-- Every value is server-written and rendered as text, never as HTML.

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null check (kind in (
    'created','payment_pending','payment_reported','payment_not_found','paid',
    'payment_expired','payment_cancelled','refunded','status_changed',
    'email_sent','note','delivered','delivery_updated',
    'duplicate_payment','payment_mismatch','dispute_opened','dispute_updated',
    'dispute_closed','coupon_applied','intake_updated','attachment_added')),
  actor text not null check (actor in ('system','admin','customer')),
  actor_user_id uuid references auth.users(id) on delete set null,
  visible_to_customer boolean not null default true,
  title text not null check (length(title) <= 160),
  body text check (length(body) <= 5000),
  data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_events_order_created
  on public.order_events (order_id, created_at);

alter table public.order_events enable row level security;

drop policy if exists order_events_select_own on public.order_events;
create policy order_events_select_own on public.order_events
  for select to authenticated
  using (
    visible_to_customer
    and exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

drop policy if exists order_events_service_role_all on public.order_events;
create policy order_events_service_role_all on public.order_events
  for all to service_role using (true) with check (true);

comment on table public.order_events is
  'Order timeline. Owner reads visible rows only; internal notes and chargeback rows are visible_to_customer = false.';
