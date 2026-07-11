-- Migration 0123: signal_scout_settings (single-row JSONB settings for the
-- Signal Scout hidden-player guessing game)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (admin server actions write; the game reads via the
--                   service-role client server-side, mirroring on_the_clock_settings
--                   and beacon_settings)
--   client writes : BLOCKED
--
-- The whole game is tuned from one editable settings object (round timing,
-- clue reveal schedule, scoring weights, player pool filters, cache TTLs, etc).
-- The shape is nested, so a single jsonb document is a better fit than a flat
-- key/value table.
--
-- Defaults live in code (lib/signal-scout/settings.ts). A missing row degrades
-- to those defaults so the game never breaks, and the admin page renders code
-- defaults until the first save creates the row. The id is pinned to 'global' so
-- there is exactly one settings row. updated_by is server-set from the verified
-- admin session, never from client input.

create table if not exists public.signal_scout_settings (
  id text primary key default 'global' check (id = 'global'),
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.signal_scout_settings enable row level security;

drop policy if exists signal_scout_settings_service_role_all on public.signal_scout_settings;
create policy signal_scout_settings_service_role_all on public.signal_scout_settings
  for all to service_role using (true) with check (true);

comment on table public.signal_scout_settings is
  'Single-row (id=global) JSONB settings for the Signal Scout hidden-player guessing game. Service-role only; code holds fallback defaults in lib/signal-scout/settings.ts. Admin-editable from /admin/signal-scout.';
