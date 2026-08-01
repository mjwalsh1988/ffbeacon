-- Migration 0024: league_power_rankings_cache
--
-- Derived pre-calc table, one row per (league, roster, format_config, source).
-- Populated by scripts/calculate-league-power-rankings.ts after each league
-- sync. UI reads this directly; never calculated on the fly.
--
-- No metadata jsonb (derived from internal data per CLAUDE.md
-- Pre-Calculated Tables rule).
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.league_power_rankings_cache (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  roster_id uuid not null references public.rosters(id) on delete cascade,
  format_config_id uuid not null references public.format_configs(id) on delete cascade,
  source text not null references public.source_registry(slug) on delete cascade,
  starter_value numeric not null default 0,
  bench_value numeric not null default 0,
  picks_value numeric not null default 0,
  total_value numeric not null default 0,
  overall_rank integer,
  starter_rank integer,
  positional_breakdowns jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  unique (league_id, roster_id, format_config_id, source)
);

create index if not exists idx_lprc_league_format_source
  on public.league_power_rankings_cache(league_id, format_config_id, source);
create index if not exists idx_lprc_roster
  on public.league_power_rankings_cache(roster_id);

alter table public.league_power_rankings_cache enable row level security;

drop policy if exists league_power_rankings_cache_select_public on public.league_power_rankings_cache;
create policy league_power_rankings_cache_select_public on public.league_power_rankings_cache
  for select to anon, authenticated using (true);

drop policy if exists league_power_rankings_cache_service_role_all on public.league_power_rankings_cache;
create policy league_power_rankings_cache_service_role_all on public.league_power_rankings_cache
  for all to service_role using (true) with check (true);

comment on table public.league_power_rankings_cache is
  'Pre-calculated power rankings per (league, roster, format, source). Derived from rosters + player_value_history + draft_pick_values. Recalculated by the league sync job. No metadata column (derived data, see CLAUDE.md).';
comment on column public.league_power_rankings_cache.positional_breakdowns is
  'jsonb shape: {QB: {value, rank, players: [{player_id, value, slot}]}, RB: {...}, WR: {...}, TE: {...}, PICKS: {value, picks: [...]}}. Powers the position-by-position view on the team page.';
