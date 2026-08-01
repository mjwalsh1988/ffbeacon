-- Migration 0163: nfl_defense_vs_position (our own opponent-strength model)
--
-- Why this exists: Sleeper's weekly projections are effectively a season average
-- repeated 18 times. Measured across six players spanning every skill position,
-- the spread between a player's best and worst projected week of 2026 is 2.6% to
-- 5.4%. Sleeper is not meaningfully adjusting for opponent, so any strength of
-- schedule derived from their numbers would rank every team the same.
--
-- We have the inputs to do it ourselves: player_stats carries 228k regular
-- season rows back to 2020 with `opponent` populated on every single one. This
-- table aggregates how many fantasy points each NFL defense allowed to each
-- position per game, and converts that into a multiplier centered on 1.0 (above
-- 1.0 means the defense gives up more than league average, so facing them is a
-- boost).
--
-- Derived table: computed FROM internal data (player_stats), so no metadata
-- jsonb. Provenance is scripts/calculate-defense-splits.ts, run after the stats
-- sync and available manually via `npm run calculate:defense-splits`.
--
-- `season` holds the source season. The engine blends the two most recent
-- seasons, weighting the current one more heavily once it has enough games,
-- which is the same recency principle applied in player_projection_accuracy.
--
-- Naming: `nfl_` prefix groups this with nfl_teams.
--
-- Access matrix (public read-only derived data pattern):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (recompute writes)
--   client writes : BLOCKED

create table if not exists public.nfl_defense_vs_position (
  team text not null,
  season integer not null,
  position text not null check (position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')),
  scoring text not null check (scoring in ('pts_ppr', 'pts_half_ppr', 'pts_std')),
  -- Fantasy points this defense allowed to the position, per game played
  -- against them, counting only players who were startable that week.
  points_allowed_per_game numeric not null,
  -- League-wide average for the same (season, position, scoring). Stored so the
  -- multiplier can be recomputed or audited without re-aggregating.
  league_average numeric not null,
  -- points_allowed_per_game / league_average, clamped by the calc so a small
  -- sample cannot produce an extreme swing.
  multiplier numeric not null,
  -- Rank within the season, 1 = most generous to this position.
  generosity_rank integer,
  games_sampled integer not null,
  computed_at timestamptz not null default now(),
  primary key (team, season, position, scoring)
);

create index if not exists idx_nfl_defense_vs_position_season
  on public.nfl_defense_vs_position(season, position, scoring);

alter table public.nfl_defense_vs_position enable row level security;

drop policy if exists nfl_defense_vs_position_select_public on public.nfl_defense_vs_position;
create policy nfl_defense_vs_position_select_public on public.nfl_defense_vs_position
  for select to anon, authenticated using (true);

drop policy if exists nfl_defense_vs_position_service_role_all on public.nfl_defense_vs_position;
create policy nfl_defense_vs_position_service_role_all on public.nfl_defense_vs_position
  for all to service_role using (true) with check (true);
