-- Migration 0344: products (what the Beacon Store sells; a second product is a
-- row here, not a code change)
--
-- Access matrix:
--   anon          : SELECT active rows only
--   authenticated : SELECT active rows only
--   service_role  : ALL (admin server actions write; admin pages read every row)
--   client writes : BLOCKED
--
-- `features` is a JSON array of strings, each 1 to 120 characters; the zod schema
-- in lib/commerce/products.ts enforces that, the column does not. `placements`
-- names the surfaces that may offer a product. Orders reference products with
-- `on delete restrict`, so a product is deactivated rather than deleted.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  family text not null check (family ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(family) <= 60),
  tier_rank integer not null default 1 check (tier_rank between 1 and 9),
  name text not null check (length(name) between 1 and 60),
  tagline text check (length(tagline) <= 140),
  description text check (length(description) <= 2000),
  features jsonb not null default '[]'::jsonb,
  badge text check (length(badge) <= 24),
  price_cents integer not null check (price_cents between 100 and 100000),
  currency text not null default 'usd' check (currency = 'usd'),
  turnaround_days integer not null default 3 check (turnaround_days between 1 and 30),
  intake_form text not null default 'team-review' check (intake_form in ('team-review')),
  requires_league_context boolean not null default true,
  placements text[] not null default '{}'::text[]
    check (placements <@ array['blueprint','league-overview','my-beacon']::text[]),
  is_active boolean not null default true,
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_active_order
  on public.products (is_active, display_order);

alter table public.products enable row level security;

drop policy if exists products_select_public on public.products;
create policy products_select_public on public.products
  for select to anon, authenticated using (is_active = true);

drop policy if exists products_service_role_all on public.products;
create policy products_service_role_all on public.products
  for all to service_role using (true) with check (true);

comment on table public.products is
  'What the Beacon Store sells. Public read of active rows; admin writes through the service role at /admin/orders/products.';

insert into public.products
  (slug, family, tier_rank, name, tagline, description, features, badge,
   price_cents, turnaround_days, placements, display_order)
values
  ('team-review-basic', 'team-review', 1, 'Basic Review',
   'A straight read of your team and two or three moves to make.',
   'Michael reads your roster against your league''s own numbers and your Team Blueprint, then writes you a short, plain review: where the team actually stands, the direction to take this season, and two or three trades worth offering, with the reasoning.',
   '["A written read of your roster, in plain words","The direction: contend, rebuild, or hold, and why","Two or three trade ideas with the reasoning","Delivered to your My Beacon portal within 3 days"]'::jsonb,
   null, 995, 3, array['blueprint','league-overview','my-beacon']::text[], 10),
  ('team-review-premium', 'team-review', 2, 'Premium Review',
   'The full write-up: every position, every call, and a plan for the rest of the season.',
   'Everything in the Basic Review, then the whole roster position by position, buy and sell calls by name, trade shapes to pursue and who in your league to call, a lineup note for the week, your draft capital, and one follow-up question by email after you have read it.',
   '["Everything in the Basic Review","Position by position: what is strong, thin, and aging","Buy, sell and hold calls by name","Trade shapes to pursue and the partners to call","A lineup note for this week and your draft capital","One follow-up question by email within 7 days","Delivered to your My Beacon portal within 5 days"]'::jsonb,
   'Most popular', 1995, 5, array['blueprint','league-overview','my-beacon']::text[], 20)
on conflict (slug) do nothing;
