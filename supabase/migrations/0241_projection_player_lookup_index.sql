-- 0241: the index the projection READ path actually needs.
--
-- ACCESS MATRIX (unchanged, re-verified after this migration)
--   anon           SELECT
--   authenticated  SELECT
--   service_role   ALL
--   This migration creates an index and nothing else. No column, no policy, no
--   constraint. RLS stays enabled with the policies already in place.
--
-- WHY A SECOND INDEX, WHEN 0239 ALREADY ADDED ONE
--
-- Because 0239's column ORDER serves the cheap half of the read path and not
-- the expensive half, and that was only visible from an EXPLAIN rather than
-- from reading the query.
--
-- 0239 created (source, season, season_type, week, player_id). Measured against
-- production on 2026-09-01:
--
--   COUNT probe, no player filter
--     (source, season, season_type, week >= 1)
--     -> Index Only Scan on the 0239 index, 5.0 ms over 18,508 rows. Good.
--
--   The actual row fetch, which is what a reader waits on
--     (source, season, season_type, week >= 1, player_id IN (10 ids))
--     -> falls back to idx_player_weekly_projections_player, Bitmap Heap Scan
--        plus Filter, 113 ms, fetching 429 rows to keep 171.
--
-- The cause is a property of btree indexes rather than a mistake in 0239.
-- `week` is used as a RANGE (>= fromWeek), and once a preceding column is
-- range-restricted rather than equality-restricted, Postgres cannot use any
-- later column as an index condition. So `player_id`, sitting after `week`,
-- degrades to a post-scan filter and the index buys nothing over the plain
-- player_id index.
--
-- Putting `player_id` BEFORE `week` fixes it: every leading column is then an
-- equality match, and the range on `week` applies last where a range belongs.
-- That is the exact shape of every chunked read on the hot path:
-- loadProjectionsChunk in lib/power-pulse/load.ts, which lib/projections/read.ts
-- calls for Trade Ideas, Beacon Steals, BEAM, FAAB and League Relay, and
-- readProjectionWeek in lib/positional-war/load.ts.
--
-- The 0239 index is deliberately KEPT. It genuinely serves the count probes and
-- the completeness guard, which run on the same path and want no player filter
-- at all. Dropping an index that is measurably doing its job, to save the write
-- cost on a table two nightly jobs write, would be a bad trade.

create index if not exists idx_player_weekly_projections_source_player
  on public.player_weekly_projections (source, season, season_type, player_id, week);

comment on index public.idx_player_weekly_projections_source_player is
  'The chunked read path: equality on source, season, season_type and player_id, with the week range applied last. Companion to idx_player_weekly_projections_source_lookup, which serves the count probes that carry no player filter.';
