-- Migration 0350: coupons, and the coupon columns on orders
--
-- Access matrix (coupons):
--   anon          : none
--   authenticated : none
--   service_role  : ALL
--   client writes : BLOCKED
--
-- Customers never read this table: the checkout previews a code through a metered
-- server action, so codes cannot be enumerated through PostgREST.
--
-- code is stored upper case; the validator upper-cases and trims what the customer
-- typed before the lookup. orders.coupon_code is a copy of the code at order time
-- so a receipt still names it after the coupon goes. Redemptions are COUNTED FROM
-- ORDERS, not from a counter: an order with this coupon_id and payment_status in
-- (unpaid, awaiting_confirmation, paid, refunded), so an abandoned order frees its
-- slot when the cron expires it. The count then insert is not atomic; two customers
-- racing the last slot of a capped code can both get it, which is accepted and
-- bounded by the per-user cap.

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4,24}$'),
  kind text not null check (kind in ('percent','amount')),
  percent_off integer check (percent_off between 1 and 100),
  amount_off_cents integer check (amount_off_cents between 1 and 100000),
  product_family text check (product_family ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  product_id uuid references public.products(id) on delete set null,
  max_redemptions integer check (max_redemptions >= 1),
  max_redemptions_per_user integer not null default 1 check (max_redemptions_per_user between 1 and 100),
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  note text check (length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'percent' and percent_off is not null and amount_off_cents is null)
      or (kind = 'amount' and amount_off_cents is not null and percent_off is null))
);

alter table public.orders
  add column if not exists coupon_id uuid references public.coupons(id) on delete set null,
  add column if not exists coupon_code text check (length(coupon_code) <= 24);

create index if not exists idx_orders_coupon on public.orders (coupon_id)
  where coupon_id is not null;

alter table public.coupons enable row level security;

drop policy if exists coupons_service_role_all on public.coupons;
create policy coupons_service_role_all on public.coupons
  for all to service_role using (true) with check (true);

drop trigger if exists coupons_set_updated_at on public.coupons;
create trigger coupons_set_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

comment on table public.coupons is
  'Checkout codes. Service-role only; previewed through a metered server action, edited at /admin/orders/coupons.';
