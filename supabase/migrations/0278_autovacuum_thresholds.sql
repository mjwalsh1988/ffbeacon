-- Migration 0278: tighter autovacuum thresholds for the two biggest tables
--
-- PERF-T061. player_value_history is 1.77 GB / 2.07M rows and had not been
-- autovacuumed since 2026-08-11. player_stats is 949 MB / 293k rows with
-- 41,328 dead tuples and had not been autovacuumed since 2026-07-24. Postgres
-- decides when to autovacuum a table from its scale factor: the default
-- (0.2) waits for dead tuples to reach 20 percent of the table's live rows,
-- so a 2M row table has to accumulate about 400k dead rows before autovacuum
-- even considers it. These two tables are written to constantly (the
-- ffbeacon value source alone writes 6,852 rows a day to
-- player_value_history) and are read on nearly every player-facing page, so
-- letting dead tuples pile up to 20 percent before cleanup means both bloat
-- and stale planner statistics for weeks at a time.
--
-- Lowering the scale factor to 0.02 (vacuum) and 0.01 (analyze) means a 2M
-- row table is vacuumed after about 40k dead rows and analyzed after about
-- 20k, roughly ten times more often. This is the only change here: the
-- retention decision for player_value_history itself (keep every row,
-- permanently) was made separately by the owner on 2026-09-08 and is not
-- reopened by this migration.
--
-- Risk: none. This only changes when autovacuum runs, not what it does or
-- what data exists afterward.
--
-- Rollback:
--   alter table public.player_value_history reset (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
--   alter table public.player_stats reset (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);

alter table public.player_value_history set (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
alter table public.player_stats set (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
