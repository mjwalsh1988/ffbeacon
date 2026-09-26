-- Migration 0312: ranking_builder_runs is written by the server only
-- (review of the Beacon Ranker build, 2026-09-26).
--
-- The run's setup (seed ids, depth, cap) and its answer log are what the
-- server folds and trusts on every answer. Under 0307 the owner could UPDATE
-- them directly with the publishable key, skipping answer validation and the
-- rate limit, and write an oversized setup the server would then fold on
-- every call. Every legitimate write already goes through a server action
-- (app/tools/custom-rankings/actions.ts), which proves ownership by reading
-- the run under the owner's own session (the select policy below) and then
-- writes with the service role. So the browser keeps SELECT and DELETE of its
-- own runs, and loses INSERT and UPDATE.
--
-- Also caps the stored setup at 256 KB: a 2,000 id seed plus the second pass
-- is well under 100 KB.
--
-- Access matrix (replaces 0307's)
--   anon          : none
--   authenticated : SELECT and DELETE own rows only
--   service_role  : ALL

drop policy if exists ranking_builder_runs_insert_own on public.ranking_builder_runs;
drop policy if exists ranking_builder_runs_update_own on public.ranking_builder_runs;

revoke insert, update on table public.ranking_builder_runs from authenticated;

alter table public.ranking_builder_runs
  drop constraint if exists chk_ranking_builder_runs_setup_size;
alter table public.ranking_builder_runs
  add constraint chk_ranking_builder_runs_setup_size
  check (pg_column_size(setup) <= 262144);
