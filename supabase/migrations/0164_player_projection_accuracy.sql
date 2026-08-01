-- Migration 0164: player_projection_accuracy (recency-weighted reliability)
--
-- How often does a player beat their projection, and by how much? We already
-- compute this live for one player on their profile page. Power Pulse needs it
-- for every rostered player in every league, so it has to be precomputed.
--
-- Recency rule (explicit product decision): the CURRENT season is a stronger
-- signal than any prior season, because teams, roles, and coaching change. The
-- calc weights each contributing game by season distance before averaging, so a
-- rookie-year breakout two seasons ago cannot outvote what a player is doing
-- right now. Prior seasons still count, at a reduced weight. The per-season
-- rows are stored alongside the blended row so the UI can show the split and so
-- the weighting can be re-tuned without re-reading player_stats.
--
-- Row shape: `season` holds a real season for a per-season row, or NULL for the
-- single blended row per (player, scoring). The blended row is what the Power
-- Pulse engine reads.
--
-- `beat_rate` counts a week as a miss when the player was projected and did not
-- play, so an injured stretch drags the number down instead of vanishing from
-- the denominator. This matches the profile page's season-wide beat rate.
--
-- `mean_ratio` is the raw average of actual / projected. `shrunk_multiplier` is
-- that ratio pulled toward 1.0 by sample size (empirical Bayes with a prior
-- weight of k games) and then clamped, so a three-game sample nudges a
-- projection instead of rewriting it. The engine uses shrunk_multiplier only.
--
-- Derived table: computed FROM internal data (player_weekly_projections joined
-- to player_stats), so no metadata jsonb. Provenance is
-- scripts/calculate-projection-accuracy.ts, run after the stats sync and
-- available manually via `npm run calculate:projection-accuracy`.
--
-- Access matrix (public read-only derived data pattern):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (recompute writes)
--   client writes : BLOCKED

create table if not exists public.player_projection_accuracy (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  -- NULL = the blended, recency-weighted row the engine reads.
  season integer,
  scoring text not null check (scoring in ('pts_ppr', 'pts_half_ppr', 'pts_std')),
  position text,
  -- Weeks where a projection existed. Missed weeks are included.
  weeks_projected integer not null default 0,
  -- Weeks where the player actually played (gp > 0).
  weeks_played integer not null default 0,
  -- Weeks the player met or beat their projection.
  weeks_beat integer not null default 0,
  beat_rate numeric,
  mean_ratio numeric,
  shrunk_multiplier numeric,
  -- Average actual minus projected, in points. Display-facing.
  mean_diff numeric,
  -- Spread of the actual / projected ratio. Feeds the per-player variance model.
  ratio_stdev numeric,
  -- weeks_played / weeks_projected. Captures the always-hurt players.
  availability_rate numeric,
  -- Sum of the per-game recency weights behind this row. Diagnostic.
  sample_weight numeric,
  computed_at timestamptz not null default now(),
  unique (player_id, season, scoring)
);

-- Partial unique index: Postgres treats NULLs as distinct in a plain UNIQUE, so
-- the blended row needs its own guard to stay singular per (player, scoring).
create unique index if not exists idx_player_projection_accuracy_blended
  on public.player_projection_accuracy(player_id, scoring)
  where season is null;

create index if not exists idx_player_projection_accuracy_lookup
  on public.player_projection_accuracy(scoring, season);

alter table public.player_projection_accuracy enable row level security;

drop policy if exists player_projection_accuracy_select_public on public.player_projection_accuracy;
create policy player_projection_accuracy_select_public on public.player_projection_accuracy
  for select to anon, authenticated using (true);

drop policy if exists player_projection_accuracy_service_role_all on public.player_projection_accuracy;
create policy player_projection_accuracy_service_role_all on public.player_projection_accuracy
  for all to service_role using (true) with check (true);
