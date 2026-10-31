-- Migration 0345: orders (the ledger), the order number sequence, the shared
-- set_updated_at trigger function, and try_mark_order_paid (the one path to paid)
--
-- Access matrix:
--   anon          : none
--   authenticated : SELECT own rows only (auth.uid() = user_id)
--   service_role  : ALL (every write goes through a server action or the webhook)
--   client writes : BLOCKED
--
-- RLS IS ROW LEVEL, NOT COLUMN LEVEL. orders_select_own hands the owner EVERY
-- column of the row through PostgREST, so nothing here may be a thing the
-- customer must not see. There is deliberately no admin_notes column: internal
-- notes are order_events rows with visible_to_customer = false (migration 0346).
--
-- metadata holds the allow-listed Stripe projection (lib/donate/redact.ts) and
-- nothing about the card or the billing address, the same exception to the
-- raw-object rule that migration 0270 documents. Name and email are never copied
-- here: user_id points at the account, and identity is read from Auth at render
-- and send time. user_id is nullable only so a deleted account leaves the
-- financial record behind; the application never inserts a null.
--
-- try_mark_order_paid is true for exactly one caller: a webhook retry, the
-- reconcile on view and a manual confirm racing each other produce one paid
-- transition and one receipt. receipt_email_status = 'pending' is set inside the
-- same statement so a process that dies after the flip and before the send leaves
-- a row the cron can see.

create sequence if not exists public.orders_number_seq start with 100001;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('FFB-' || nextval('public.orders_number_seq')::text),
  user_id uuid references auth.users(id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  product_snapshot jsonb not null,
  origin text not null default 'customer' check (origin in ('customer','admin')),
  list_price_cents integer not null check (list_price_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0 and discount_cents <= list_price_cents),
  amount_cents integer not null check (amount_cents >= 0 and amount_cents = list_price_cents - discount_cents),
  currency text not null default 'usd' check (currency = 'usd'),
  payment_method text not null check (payment_method in ('stripe','paypal','venmo','complimentary')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','awaiting_confirmation','paid','expired','cancelled','refunded')),
  fulfillment_status text not null default 'pending_payment'
    check (fulfillment_status in ('pending_payment','queued','in_progress','delivered','cancelled')),
  stripe_session_id text unique,
  stripe_session_attempts integer not null default 0 check (stripe_session_attempts >= 0),
  stripe_session_expires_at timestamptz,
  stripe_payment_intent_id text,
  livemode boolean,
  external_payment_reference text check (length(external_payment_reference) <= 120),
  customer_reported_paid_at timestamptz,
  paid_at timestamptz,
  paid_via text check (paid_via in ('stripe-webhook','stripe-reconcile','manual','coupon','complimentary')),
  due_at timestamptz,
  started_at timestamptz,
  delivered_at timestamptz,
  expires_at timestamptz,
  reminder_sent_at timestamptz,
  cancelled_at timestamptz,
  refunded_cents integer not null default 0 check (refunded_cents >= 0 and refunded_cents <= amount_cents),
  refunded_at timestamptz,
  refund_note text check (length(refund_note) <= 500),
  receipt_email_status text check (receipt_email_status in ('pending','sent','failed','skipped')),
  receipt_email_sent_at timestamptz,
  receipt_email_attempts integer not null default 0,
  receipt_email_error text check (length(receipt_email_error) <= 500),
  duplicate_payment_intent_id text,
  duplicate_resolved_at timestamptz,
  mismatch_amount_cents integer,
  dispute_id text,
  dispute_status text check (dispute_status in ('open','won','lost','warning_closed')),
  disputed_at timestamptz,
  context jsonb not null default '{}'::jsonb,
  intake jsonb not null default '{}'::jsonb,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_user_created on public.orders (user_id, created_at desc);
create index if not exists idx_orders_payment_status on public.orders (payment_status)
  where payment_status in ('unpaid','awaiting_confirmation');
create index if not exists idx_orders_fulfillment on public.orders (fulfillment_status, due_at);
create index if not exists idx_orders_created on public.orders (created_at desc);
create index if not exists idx_orders_payment_intent on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create index if not exists idx_orders_receipt_retry on public.orders (receipt_email_status)
  where receipt_email_status in ('pending','failed');
create index if not exists idx_orders_attention on public.orders (dispute_status)
  where dispute_status = 'open';

alter table public.orders enable row level security;

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists orders_service_role_all on public.orders;
create policy orders_service_role_all on public.orders
  for all to service_role using (true) with check (true);

comment on table public.orders is
  'Beacon Store orders. Owner select; every write is a server action or the webhook through the service role. No column here may be one the customer must not see.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create or replace function public.try_mark_order_paid(
  p_order_id uuid,
  p_paid_via text,
  p_reference text default null,
  p_paid_at timestamptz default now(),
  p_payment_intent_id text default null,
  p_livemode boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer;
  v_won boolean := false;
begin
  select coalesce((product_snapshot->>'turnaround_days')::int, 3)
    into v_days from public.orders where id = p_order_id;

  update public.orders
     set payment_status = 'paid',
         fulfillment_status = 'queued',
         paid_at = p_paid_at,
         paid_via = p_paid_via,
         due_at = p_paid_at + make_interval(days => v_days),
         external_payment_reference = coalesce(p_reference, external_payment_reference),
         stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
         livemode = coalesce(p_livemode, livemode),
         expires_at = null,
         mismatch_amount_cents = null,
         receipt_email_status = 'pending',
         updated_at = now()
   where id = p_order_id
     and payment_status in ('unpaid','awaiting_confirmation','expired')
  returning true into v_won;

  return coalesce(v_won, false);
end;
$$;

revoke all on function public.try_mark_order_paid(uuid, text, text, timestamptz, text, boolean)
  from public, anon, authenticated;
grant execute on function public.try_mark_order_paid(uuid, text, text, timestamptz, text, boolean)
  to service_role;
