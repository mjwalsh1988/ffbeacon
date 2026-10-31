-- Migration 0343: commerce_settings (single-row JSONB settings for the Beacon
-- Store: storefront door, payment methods, notifications, rate limits, placements)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (admin server actions write; the storefront reads via the
--                   service-role client server-side)
--   client writes : BLOCKED
--
-- Defaults live in code (lib/commerce/settings.ts and
-- lib/commerce/default-settings.ts). A missing row degrades to those defaults, and
-- the row is first written by /admin/orders/settings. The id is pinned to 'global'
-- so there is exactly one settings row. updated_by is server-set from the verified
-- admin session, never from client input.

create table if not exists public.commerce_settings (
  id text primary key default 'global' check (id = 'global'),
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.commerce_settings enable row level security;

drop policy if exists commerce_settings_service_role_all on public.commerce_settings;
create policy commerce_settings_service_role_all on public.commerce_settings
  for all to service_role using (true) with check (true);

comment on table public.commerce_settings is
  'Single-row (id=global) JSONB settings for the Beacon Store. Service-role only; code holds fallback defaults in lib/commerce/settings.ts. Admin-editable from /admin/orders/settings.';
