-- Migration 0347: order_messages (free-form emails the admin sent about an order,
-- which the customer can read back in the portal)
--
-- Access matrix:
--   anon          : none
--   authenticated : SELECT rows on own orders (every message was sent to them)
--   service_role  : ALL
--   client writes : BLOCKED
--
-- direction admits only outbound today; an inbound value is a later migration.

create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  direction text not null default 'outbound' check (direction in ('outbound')),
  subject text not null check (length(subject) between 1 and 160),
  body_text text not null check (length(body_text) between 1 and 8000),
  sent_by uuid references auth.users(id) on delete set null,
  status text not null check (status in ('sent','failed','skipped')),
  resend_message_id text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_messages_order_created
  on public.order_messages (order_id, created_at);

alter table public.order_messages enable row level security;

drop policy if exists order_messages_select_own on public.order_messages;
create policy order_messages_select_own on public.order_messages
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));

drop policy if exists order_messages_service_role_all on public.order_messages;
create policy order_messages_service_role_all on public.order_messages
  for all to service_role using (true) with check (true);

comment on table public.order_messages is
  'Outbound messages about an order, readable by its owner. Written by the admin composer through the service role.';
