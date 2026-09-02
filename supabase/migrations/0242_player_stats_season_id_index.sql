-- 0242: let a season-scoped keyset walk over player_stats use an index.
--
-- ACCESS MATRIX (unchanged, re-verified after this migration)
--   anon           SELECT
--   authenticated  SELECT
--   service_role   ALL
--   Index only. No column, no policy, no constraint. RLS stays enabled with the
--   policies already in place.
--
-- WHY
--
-- Two jobs page player_stats with a keyset walk, ordering by `id` so that pages
-- cannot skip or duplicate rows: lib/build-beacon-projections.ts loadStats and
-- lib/calculate-defense-splits.ts loadSeasonStats. Both also filter on season
-- and season_type.
--
-- Those two requirements fought each other. `idx_stats_season_type` covers
-- (season, season_type) but carries no id, so ordering by id could not use it.
-- Postgres therefore walked the PRIMARY KEY in id order and applied the season
-- filter row by row as it went.
--
-- Measured on 2026-09-01, one 1,000 row page of the projection builder's stat
-- read:
--
--   Index Scan using player_stats_pkey
--     Filter: season_type = 'regular' AND season = ANY ('{2026,2025,2024}')
--     Rows Removed by Filter: 8,595
--     Buffers: shared hit=3,559 read=8,355
--     Execution Time: 5,276 ms
--
-- Eight and a half thousand disk pages read to return one thousand rows, and
-- five seconds a page. Across the 24 pages the builder needs, that was 119 of
-- its 140 second runtime, against a 300 second cron ceiling. The compute this
-- whole engine exists to do takes 0.3 seconds; the rest was this.
--
-- Adding `id` as the trailing column makes the walk an ordered index scan: the
-- season and season_type equalities are index conditions, and `id` supplies the
-- sort for free.
--
-- ONE SEASON AT A TIME IS PART OF THE FIX
--
-- This index can only supply the id ordering when the leading columns are
-- EQUALITIES. `season IN (2026, 2025, 2024)` is not one equality, so a query
-- shaped that way would still have to sort. lib/build-beacon-projections.ts
-- loadStats was changed alongside this migration to walk each season
-- separately, which is also how lib/calculate-defense-splits.ts already reads.
--
-- `idx_stats_season_type` is left in place. It still serves the reads that
-- filter on season and season_type without needing an ordering, and dropping a
-- working index to save write cost on a table one nightly job appends to would
-- be a bad trade.

create index if not exists idx_player_stats_season_id
  on public.player_stats (season, season_type, id);

comment on index public.idx_player_stats_season_id is
  'Season-scoped keyset walks: equality on season and season_type with id supplying the sort. Without it, ordering by id forced a primary-key walk that read 8,355 disk pages to return 1,000 rows.';
