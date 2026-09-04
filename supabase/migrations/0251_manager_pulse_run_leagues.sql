-- Migration 0251: manager_pulse_run_leagues (what one run is waiting on)
--
-- Why this table exists rather than counting jobs
--   A Manager Pulse run needs N league-seasons captured. Some of those leagues
--   are already fresh in public.leagues and need no work at all. Some need a
--   footprint sync, which is queued as a league_sync_jobs row. And some are
--   ALREADY queued, because the same user pressed Sync all ten minutes ago:
--   league_sync_jobs_active_unique means that insert is dropped, so counting
--   inserted jobs would undercount the run and its progress bar would sit at
--   90% forever.
--
--   So the run's list of leagues is its own thing. Each row is one league-season
--   the run needs, carrying its own status and, when work was needed, a pointer
--   to the job doing it. Progress is a count over these rows and nothing else.
--
--   'fresh' and 'done' are kept apart on purpose. Both mean the data is there,
--   but only one of them cost a Sleeper round trip, and that is the difference
--   between a run that was free and a run that spent the budget.
--
-- Access matrix
--   anon          : none
--   authenticated : SELECT rows belonging to own runs (the page polls progress)
--   service_role  : ALL
--   client writes : BLOCKED
--
-- Rollback note (no down migration ships):
--   drop table if exists public.manager_pulse_run_leagues;

create table if not exists public.manager_pulse_run_leagues (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.manager_pulse_runs(id) on delete cascade,
  -- Denormalized from the run so the owner policy needs no join, the same
  -- reasoning league_sync_jobs.user_id carries.
  user_id uuid not null references auth.users(id) on delete cascade,
  sleeper_league_id text not null,
  season int not null,
  league_name text,
  -- One of the four buckets in lib/league-category.ts, or null when the league's
  -- raw Sleeper object has not been stored yet. Null routes to neither lens.
  league_category text
    check (league_category is null or league_category in (
      'dynasty', 'redraft', 'best-ball-dynasty', 'best-ball-redraft'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'fresh', 'queued', 'done', 'failed', 'skipped')),
  -- Set when this league needed a capture. Null when it was already fresh, or
  -- when it was skipped past the run cap.
  job_id uuid references public.league_sync_jobs(id) on delete set null,
  detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.manager_pulse_run_leagues is
  'One row per league-season a Manager Pulse run needs. The run progress bar counts these, not jobs, because a league already queued by another request produces no new job row. Owner-readable, service_role-writable.';

-- A league appears once per run.
create unique index if not exists manager_pulse_run_leagues_unique
  on public.manager_pulse_run_leagues (run_id, sleeper_league_id, season);

-- The progress count.
create index if not exists manager_pulse_run_leagues_run_idx
  on public.manager_pulse_run_leagues (run_id, status);

-- The worker's reverse lookup: this job finished, which run rows does it close.
create index if not exists manager_pulse_run_leagues_job_idx
  on public.manager_pulse_run_leagues (job_id)
  where job_id is not null;

alter table public.manager_pulse_run_leagues enable row level security;

drop policy if exists manager_pulse_run_leagues_service_role_all
  on public.manager_pulse_run_leagues;
create policy manager_pulse_run_leagues_service_role_all
  on public.manager_pulse_run_leagues
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists manager_pulse_run_leagues_select_own
  on public.manager_pulse_run_leagues;
create policy manager_pulse_run_leagues_select_own
  on public.manager_pulse_run_leagues
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.manager_pulse_run_leagues from anon, authenticated;
grant select on table public.manager_pulse_run_leagues to authenticated;
