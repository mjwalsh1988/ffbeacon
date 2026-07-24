-- Migration 0142: player_positional_finishes (precomputed positional ranks)
--
-- #2 (performance): the profile hero, overview sidebar, and statistics tab all
-- render "WR12 in 2024"-style positional finishes. These came live from the
-- get_player_positional_finishes RPC, which re-aggregates and re-ranks an entire
-- position's player_stats on every page load (and twice on the stats tab). This
-- table is the derived, nightly-refreshed cache of that RPC's output so the read
-- path is a single indexed SELECT.
--
-- Derived table: like player_value_trends, this is computed FROM internal data
-- (player_stats), not ingested from an external source, so it carries NO metadata
-- jsonb. Provenance is scripts/calculate-positional-finishes.ts, run nightly after
-- the stats sync and available manually via `npm run calculate:finishes`.
--
-- Access matrix (public read-only derived data pattern):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (nightly recompute writes)
--   client writes : BLOCKED

create table if not exists public.player_positional_finishes (
  player_id uuid not null references public.players(id) on delete cascade,
  season integer not null,
  scoring text not null check (scoring in ('pts_ppr', 'pts_half_ppr', 'pts_std')),
  position text not null,
  finish integer not null,
  total_points numeric not null,
  players_ranked integer not null,
  computed_at timestamptz not null default now(),
  primary key (player_id, season, scoring)
);

-- Supports the calc's per-(season, scoring) rank sweep and any position browse.
create index if not exists idx_player_positional_finishes_pos_season
  on public.player_positional_finishes(position, season, scoring);

alter table public.player_positional_finishes enable row level security;

drop policy if exists player_positional_finishes_select_public on public.player_positional_finishes;
create policy player_positional_finishes_select_public on public.player_positional_finishes
  for select to anon, authenticated using (true);

drop policy if exists player_positional_finishes_service_role_all on public.player_positional_finishes;
create policy player_positional_finishes_service_role_all on public.player_positional_finishes
  for all to service_role using (true) with check (true);
