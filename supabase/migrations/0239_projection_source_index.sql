-- 0239: an index that survives a second projection source.
--
-- ACCESS MATRIX (unchanged, re-verified after this migration)
--   anon           SELECT
--   authenticated  SELECT
--   service_role   ALL
--   This migration creates an index and nothing else. It adds no column, no
--   policy, and no constraint, and RLS stays enabled with the policies that
--   were already there.
--
-- WHY
--
-- `player_weekly_projections` already keys uniqueness on
-- (source, season_type, season, week, sleeper_player_id), so a second source can
-- land beside Sleeper with no schema change at all. What it does NOT have is an
-- index whose leading column is `source`.
--
-- Every hot read in the codebase filters season, season_type and week and then
-- restricts to a chunk of player ids: see loadProjectionsChunk in
-- lib/power-pulse/load.ts, readProjectionWeek in lib/positional-war/load.ts, and
-- the six raw readers PE-T041 through PE-T046 migrate. Today those all resolve
-- through idx_player_weekly_projections_season_week, which does not know about
-- `source` because there has only ever been one.
--
-- The moment ffbeacon rows exist, every one of those scans doubles the rows it
-- must examine and discard, on the read path of the most-visited page in the
-- product. Adding source as the leading column keeps the scan the same size it
-- is today no matter how many sources we eventually store.
--
-- The player id is the trailing column rather than absent because the chunked
-- `.in("player_id", ...)` reads are the ones that matter; it turns a filter into
-- an index condition. `idx_player_weekly_projections_season_week` is left in
-- place: it still serves the source-agnostic reads (the accuracy grader walks
-- the whole table) and dropping an index to save nothing is how a slow query
-- appears three weeks later.

create index if not exists idx_player_weekly_projections_source_lookup
  on public.player_weekly_projections (source, season, season_type, week, player_id);

comment on index public.idx_player_weekly_projections_source_lookup is
  'Keeps a source-filtered projection read the same cost it was when Sleeper was the only source. Leading column is source on purpose.';
