-- Migration 0015: dedupe rankings + restore upsert idempotence
--
-- Access matrix (rankings) unchanged:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED
--
-- Problem
-- -------
-- The original constraint
--   UNIQUE (player_id, format_config_id, source, week, season)
-- uses Postgres' default NULLS DISTINCT semantics. For Option-A "current
-- snapshot" rankings, `week` is always NULL, so two rows that are otherwise
-- identical (same player + format + source + season, week=NULL) are NOT
-- considered conflicting. scripts/seed-rankings.ts upserts with
-- onConflict="player_id,format_config_id,source,week,season"; the upsert
-- silently fails to match existing snapshot rows and inserts new ones each
-- run, producing the "every player appears twice" bug on /rankings.
--
-- Pre-migration state (verified via MCP):
--   total_rows = 3983
--   distinct (player_id, format_config_id, source) keys = 2002
--   keys_with_dupes = 1981 (all cnt = 2; no triplicates)
--
-- Fix
-- ---
-- 1) Dedupe in place: keep the row with the most recent generated_at per
--    (player_id, format_config_id, source, week, season). Tiebreak on id
--    to keep the operation deterministic.
-- 2) Drop the legacy NULLS-DISTINCT unique constraint.
-- 3) Recreate it with NULLS NOT DISTINCT so NULL week values collide as
--    expected. PG 17 (this project) fully supports this syntax.
--
-- After this migration, seed-rankings.ts upserts become idempotent: rerunning
-- the seed updates the snapshot in place instead of doubling the row count.

with ranked as (
  select
    id,
    row_number() over (
      partition by player_id, format_config_id, source, week, season
      order by generated_at desc, id desc
    ) as rn
  from public.rankings
)
delete from public.rankings
where id in (select id from ranked where rn > 1);

alter table public.rankings
  drop constraint if exists rankings_player_id_format_config_id_source_week_season_key;

alter table public.rankings
  add constraint rankings_player_id_format_config_id_source_week_season_key
  unique nulls not distinct (player_id, format_config_id, source, week, season);
