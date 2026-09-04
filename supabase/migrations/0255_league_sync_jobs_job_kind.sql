-- Migration 0255: league_sync_jobs.job_kind
--
-- Why one column instead of a second queue
--   Manager Pulse needs leagues captured, which is the work the Sync all queue
--   already does. Standing up a second queue would mean a second worker, a
--   second pace, a second budget, and two things independently deciding how hard
--   to lean on Sleeper. Sharing this one means Manager Pulse cannot outrun it,
--   because there is only one drain.
--
--   What differs is the DEPTH of the sync. A full pulse also syncs matchups and
--   computes trade-value power rankings, Power Pulse, Positional WAR and
--   optionally the Manager Ledger. Manager Pulse needs the league, its rosters,
--   its members, its drafts, its transactions and its brackets, and nothing
--   else. Running the full pulse forty times to read a draft board would be
--   most of an hour of compute for data nobody asked for.
--
--   So: one column, two values, and the worker switches on it.
--
-- 'pulse' is the default, so every existing row and every existing enqueue path
-- (enqueue_bulk_league_sync inserts no job_kind) keeps working untouched.
--
-- Access matrix: unchanged. league_sync_jobs stays owner-readable and
-- service_role-writable exactly as migration 0172 left it.
--
-- Rollback note (no down migration ships):
--   alter table public.league_sync_jobs drop column if exists job_kind;

alter table public.league_sync_jobs
  add column if not exists job_kind text not null default 'pulse';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'league_sync_jobs_job_kind_check'
  ) then
    alter table public.league_sync_jobs
      add constraint league_sync_jobs_job_kind_check
      check (job_kind in ('pulse', 'footprint'));
  end if;
end $$;

comment on column public.league_sync_jobs.job_kind is
  'How deep a sync this job runs. pulse = the full pulseLeague (Sync all). footprint = pulseLeagueFootprint, which is core + transactions + brackets only, queued by Manager Pulse. Defaulted so every pre-existing row and enqueue path is unaffected.';

-- The worker claims oldest-due-first regardless of kind, so no new index is
-- needed for claiming. This one serves the admin runs page, which asks how much
-- of the current backlog belongs to Manager Pulse.
create index if not exists league_sync_jobs_kind_pending_idx
  on public.league_sync_jobs (job_kind, run_after)
  where status = 'pending';
