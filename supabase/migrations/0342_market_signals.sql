-- Migration 0342: Market Signals
--
-- A nightly engine places every priced player's current market value inside
-- Bollinger bands built from his own last 30 days of value history, and labels
-- him buy, watch buy, hold, watch sell or sell, per format and per source.
-- Written by /api/cron/market-signals (lib/market-signals/engine.ts). Plan of
-- record: docs/team-blueprint/team-blueprint-plan.md sections 5 and 7.3.
--
-- Numbered 0342 ahead of 0341 on purpose: the plan's build order applies the
-- market signals tables (Phase B) before the blueprint cache (Phase D).
--
-- DATABASE SIZE IS A DESIGN CONSTRAINT (plan section 7.4)
--
--   player_value_signals         LATEST ONLY: one row per (player, format,
--                                source), overwritten nightly. About 20,000
--                                rows, fixed.
--   player_value_signal_changes  CHANGE ONLY: one row per state change, append
--                                only, pruned past 730 days by the engine.
--   market_signal_runs           One row per partition per day, pruned past
--                                90 days by the engine.
--   market_signal_settings       One global jsonb row.
--
-- Nothing is added to player_value_history, ever: no band columns, no flags,
-- no extra rows. The player profile chart recomputes its band on the fly from
-- the series it already loads, with the same pure function the cron uses.
--
-- These are derived tables (pre-calculated from internal data), so they carry
-- no metadata column, per the Data Architecture section of CLAUDE.md.
--
-- ACCESS MATRIX
--
--   table                        anon/authenticated      service_role
--   player_value_signals         select                  all
--   player_value_signal_changes  select                  all
--   market_signal_runs           none                    all
--   market_signal_settings       none                    all
--
-- No client writes anywhere. The signals are public market data, the same
-- class as player_value_trends; the run log and the settings are operational.

-- ---------------------------------------------------------------------------
-- Latest signal per (player, format, source)
-- ---------------------------------------------------------------------------
create table if not exists public.player_value_signals (
  player_id uuid not null references public.players(id) on delete cascade,
  format_config_id uuid not null references public.format_configs(id) on delete cascade,
  source text not null,
  -- The series' latest UTC day with a value.
  as_of_day date not null,
  market_value numeric not null,
  mean_30 numeric,
  stdev_30 numeric,
  band_upper numeric,
  band_lower numeric,
  -- (value - lower) / (upper - lower), unclamped, three decimals.
  band_pct numeric,
  -- (upper - lower) / mean, three decimals.
  bandwidth numeric,
  points_in_window integer not null,
  signal text not null
    check (signal in ('buy', 'watch_buy', 'hold', 'watch_sell', 'sell', 'baseline', 'thin')),
  previous_signal text,
  -- The day the current signal began, for "Buy window since Oct 3".
  signal_since date,
  model_version integer not null,
  computed_at timestamptz not null default now(),
  primary key (player_id, format_config_id, source)
);

create index if not exists idx_player_value_signals_windows
  on public.player_value_signals (format_config_id, source, signal)
  where signal in ('buy', 'sell');

create index if not exists idx_player_value_signals_band_pct
  on public.player_value_signals (format_config_id, source, band_pct);

alter table public.player_value_signals enable row level security;

drop policy if exists player_value_signals_select_public on public.player_value_signals;
create policy player_value_signals_select_public
  on public.player_value_signals
  for select to anon, authenticated
  using (true);

drop policy if exists player_value_signals_service_role_all on public.player_value_signals;
create policy player_value_signals_service_role_all
  on public.player_value_signals
  for all to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- One row per state change
-- ---------------------------------------------------------------------------
create table if not exists public.player_value_signal_changes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  format_config_id uuid not null references public.format_configs(id) on delete cascade,
  source text not null,
  changed_on date not null,
  from_signal text,
  to_signal text not null,
  market_value numeric not null,
  band_pct numeric,
  unique (player_id, format_config_id, source, changed_on)
);

create index if not exists idx_player_value_signal_changes_player
  on public.player_value_signal_changes (player_id, format_config_id, source, changed_on desc);

-- The 730-day prune deletes by date.
create index if not exists idx_player_value_signal_changes_changed_on
  on public.player_value_signal_changes (changed_on);

alter table public.player_value_signal_changes enable row level security;

drop policy if exists player_value_signal_changes_select_public
  on public.player_value_signal_changes;
create policy player_value_signal_changes_select_public
  on public.player_value_signal_changes
  for select to anon, authenticated
  using (true);

drop policy if exists player_value_signal_changes_service_role_all
  on public.player_value_signal_changes;
create policy player_value_signal_changes_service_role_all
  on public.player_value_signal_changes
  for all to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- One row per partition per day: the resumability stamp and the admin log
-- ---------------------------------------------------------------------------
create table if not exists public.market_signal_runs (
  id uuid primary key default gen_random_uuid(),
  format_config_id uuid not null references public.format_configs(id) on delete cascade,
  source text not null,
  as_of_day date not null,
  rows_written integer not null,
  changes_written integer not null,
  duration_ms integer not null,
  ran_at timestamptz not null default now(),
  unique (format_config_id, source, as_of_day)
);

create index if not exists idx_market_signal_runs_ran_at
  on public.market_signal_runs (ran_at desc);

alter table public.market_signal_runs enable row level security;

drop policy if exists market_signal_runs_service_role_all on public.market_signal_runs;
create policy market_signal_runs_service_role_all
  on public.market_signal_runs
  for all to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Engine settings, one global row
-- ---------------------------------------------------------------------------
create table if not exists public.market_signal_settings (
  id text primary key default 'global',
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint market_signal_settings_singleton check (id = 'global')
);

alter table public.market_signal_settings enable row level security;

drop policy if exists market_signal_settings_service_role_all on public.market_signal_settings;
create policy market_signal_settings_service_role_all
  on public.market_signal_settings
  for all to service_role
  using (true)
  with check (true);
