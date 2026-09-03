-- 0248: the index the source-scoped freshness probe needs.
--
-- ACCESS MATRIX (unchanged, re-verified after this migration)
--   anon           SELECT
--   authenticated  SELECT
--   service_role   ALL
--   This migration creates an index and nothing else. It adds no column, no
--   policy and no constraint, and RLS stays enabled with the policies that were
--   already there.
--
-- WHY
--
-- lib/positional-war/load.ts loadProjectionsSnapshot answers "has a projection
-- sync landed since this curve was built". It is a max(updated_at) read,
-- expressed as an ORDER BY updated_at DESC LIMIT 1, and it now filters on
-- `source` so a curve built from one source cannot be invalidated by the other
-- one's sync.
--
-- That filter had no index behind it. The planner satisfies the ORDER BY with
-- idx_player_weekly_projections_season_updated (season, season_type,
-- updated_at desc) and applies `source` as a heap predicate. Every row from one
-- sync run shares a single updated_at, so the rows cluster by source: a scan
-- for the OLDER source has to walk the whole of the newer one before it reaches
-- its first match. Measured on this database with 18,563 rows per source for
-- 2026:
--
--   without this index   15.263 ms warm, 2367 ms cold, 5091 buffers,
--                        18,565 rows removed by filter
--   with this index       0.082 ms warm, 3 buffers, 1 row examined
--
-- This sits on the WARM path of every route under /leagues/[id]: buildWarContext
-- runs on every view of a league whose curve is already fresh, by design, and it
-- is awaited inside pulseLeagueDerived. It also grows linearly as seasons
-- accumulate.
--
-- Leading with `source` rather than extending the existing index keeps that one
-- serving the source-agnostic reads (the accuracy grader walks the whole table).
-- `week` is deliberately absent: it is a range predicate, so it cannot precede
-- updated_at in the ordering, and as a filter it costs nothing because the first
-- row examined already satisfies it in every real window.

create index if not exists idx_player_weekly_projections_source_season_updated
  on public.player_weekly_projections (source, season, season_type, updated_at desc);

comment on index public.idx_player_weekly_projections_source_season_updated is
  'Serves the source-scoped max(updated_at) freshness probe in lib/positional-war/load.ts loadProjectionsSnapshot. See migration 0248 for the measurements.';
