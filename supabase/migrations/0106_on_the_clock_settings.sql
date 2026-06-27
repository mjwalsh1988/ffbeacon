-- Migration 0106: on_the_clock_settings (single-row JSONB settings for the
-- public On The Clock live-draft helper)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (admin server actions write; the public tool reads via the
--                   service-role client server-side, mirroring faab_calculator_settings
--                   and beacon_settings)
--   client writes : BLOCKED
--
-- The whole tool is tuned from one editable settings object (sync cooldown, player
-- pools, recommendation weights, DST/K gates, cache TTLs, etc). The shape is nested,
-- so a single jsonb document is a better fit than a flat key/value table.
--
-- Defaults live in code (lib/on-the-clock/default-settings.ts). A missing row degrades
-- to those defaults so the public tool never breaks, and the admin page renders code
-- defaults until the first save creates the row. The id is pinned to 'global' so there
-- is exactly one settings row. updated_by is server-set from the verified admin
-- session, never from client input.

create table if not exists public.on_the_clock_settings (
  id text primary key default 'global' check (id = 'global'),
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.on_the_clock_settings enable row level security;

drop policy if exists on_the_clock_settings_service_role_all on public.on_the_clock_settings;
create policy on_the_clock_settings_service_role_all on public.on_the_clock_settings
  for all to service_role using (true) with check (true);

comment on table public.on_the_clock_settings is
  'Single-row (id=global) JSONB settings for the public On The Clock live-draft helper. Service-role only; code holds fallback defaults in lib/on-the-clock/default-settings.ts. Admin-editable from /admin/on-the-clock.';
