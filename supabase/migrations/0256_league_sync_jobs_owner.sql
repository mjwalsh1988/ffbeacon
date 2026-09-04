-- Migration 0256: league_sync_jobs gets a second owner
--
-- Until now every job in this queue came from one place: a press of Sync all on
-- /my-beacon/sleeper-leagues, which is why request_id was NOT NULL and pointed
-- at league_bulk_sync_requests. Manager Pulse now queues into the same drain,
-- and its jobs belong to a manager_pulse_runs row instead.
--
-- Two changes, one idea:
--   request_id      becomes nullable
--   manager_run_id  is added, nullable, cascading like request_id does
--   a check enforces that EXACTLY ONE of them is set
--
-- Exactly one, not at-least-one: a job with two owners would be closed twice and
-- counted twice, and a job with none is an orphan the reaper cannot attribute.
-- The constraint is what makes "who queued this" a question with one answer.
--
-- What deliberately does NOT change
--   league_sync_jobs_active_unique still keys on (user_id, sleeper_league_id) for
--   pending and processing rows, and still does not include job_kind. That is the
--   point: if a bulk sync is already syncing a league, a Manager Pulse run wants
--   THAT sync, not a second concurrent one against the same Sleeper league. The
--   enqueue RPC links to the existing job rather than inserting a duplicate, and
--   manager_pulse_run_leagues is what remembers the link.
--
-- Access matrix: unchanged from migration 0172.
--
-- Rollback note (no down migration ships):
--   alter table public.league_sync_jobs drop constraint if exists league_sync_jobs_one_owner;
--   alter table public.league_sync_jobs drop column if exists manager_run_id;
--   alter table public.league_sync_jobs alter column request_id set not null;

alter table public.league_sync_jobs
  alter column request_id drop not null;

alter table public.league_sync_jobs
  add column if not exists manager_run_id uuid
    references public.manager_pulse_runs(id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'league_sync_jobs_one_owner'
  ) then
    alter table public.league_sync_jobs
      add constraint league_sync_jobs_one_owner
      check (num_nonnulls(request_id, manager_run_id) = 1);
  end if;
end $$;

comment on column public.league_sync_jobs.manager_run_id is
  'The Manager Pulse run that queued this job, when one did. Exactly one of request_id and manager_run_id is set, enforced by league_sync_jobs_one_owner.';

comment on column public.league_sync_jobs.request_id is
  'The Sync all press that queued this job, when one did. Nullable since migration 0256: a Manager Pulse job carries manager_run_id instead.';

-- Closing out a run: every job it queued.
create index if not exists league_sync_jobs_manager_run_idx
  on public.league_sync_jobs (manager_run_id)
  where manager_run_id is not null;
