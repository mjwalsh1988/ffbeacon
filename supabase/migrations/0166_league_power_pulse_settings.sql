-- Migration 0166: league_power_pulse_settings (tunable Power Pulse model)
--
-- Every weight, cap, and toggle in the Power Pulse calculation lives here so the
-- model can be re-tuned from the admin panel without a deploy. This mirrors how
-- beacon_settings, on_the_clock_settings, and faab_calculator_settings work: one
-- pinned row holding a nested jsonb document.
--
-- Defaults live in code (lib/power-pulse/default-settings.ts). A missing row
-- degrades to those defaults, so the feature never breaks on a fresh database
-- and the admin page renders code defaults until the first save.
--
-- Naming: `league_power_pulse_` matches league_power_pulse_cache so the model
-- and its output sort together in the table browser.
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (admin server action writes; the engine reads
--                   server-side through the service-role client)
--   client writes : BLOCKED

create table if not exists public.league_power_pulse_settings (
  id text primary key default 'global' check (id = 'global'),
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.league_power_pulse_settings enable row level security;

drop policy if exists league_power_pulse_settings_service_role_all on public.league_power_pulse_settings;
create policy league_power_pulse_settings_service_role_all on public.league_power_pulse_settings
  for all to service_role using (true) with check (true);

comment on table public.league_power_pulse_settings is
  'Single-row (id=global) JSONB model config for Power Pulse: component weights, recency weights, reliability caps, injury multipliers, simulation count. Service-role only; fallback defaults in lib/power-pulse/default-settings.ts.';
