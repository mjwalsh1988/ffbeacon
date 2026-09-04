-- Migration 0250: manager_pulse_runs (one row per Manager Pulse lookup)
--
-- What this backs
--   Three jobs in one table, the same way league_bulk_sync_requests does:
--
--   1. The rate-limit ledger. The newest row per user is what the per-user
--      cooldown is measured from, so there is no second table to keep in step.
--   2. The progress source. The page's progress bar is leagues_done over
--      leagues_total, both counted here, because a bar bound to anything else is
--      a bar that makes a promise it cannot keep.
--   3. The observability record. status + detail is what /admin/manager-pulse/runs
--      shows an admin when a capture stalls.
--
-- Access matrix
--   anon          : none
--   authenticated : SELECT own rows only (the page polls its own run's progress)
--   service_role  : ALL
--   client writes : BLOCKED on every path. The cooldown and the queue depth are
--                   exactly the two things a client would want to lie about, so
--                   the claim happens in an RPC (migration 0256), not in a route.
--
-- detail is SERVER-WRITTEN, never user-controlled, and rendered as text and never
-- as HTML, the same rule positional_war_detail and manager_ledger_detail carry.
--
-- sleeper_handle is stored alongside sleeper_user_id because a handle can be
-- renamed. The id is what everything keys on; the handle is what the admin page
-- shows so a row is recognisable.
--
-- Rollback note (no down migration ships):
--   drop table if exists public.manager_pulse_runs;

create table if not exists public.manager_pulse_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Sleeper's own user id for the manager being looked up. No FK: the subject of
  -- a report is almost never a user of this site.
  sleeper_user_id text not null,
  sleeper_handle text,
  season_from int not null,
  season_to int not null,
  status text not null default 'pending'
    check (status in ('pending', 'capturing', 'computing', 'complete', 'error', 'throttled')),
  leagues_total int not null default 0,
  leagues_done int not null default 0,
  leagues_failed int not null default 0,
  -- Per-section readiness, so the page can render the sections that are ready
  -- instead of waiting for the slowest one.
  section_status jsonb not null default '{}'::jsonb,
  detail text,
  -- A run that queued nothing did no work: every league it needed was already
  -- fresh. Charging a reader their next hour for that would punish them for the
  -- cache being warm, which is exactly backwards. The capture step flips this to
  -- false when it queues zero jobs, and the cooldown query ignores those rows.
  -- Same reasoning as enqueue_bulk_league_sync deleting its request row on
  -- 'already_queued'; a column rather than a delete because the run still has to
  -- exist for the page to read its (already complete) progress from.
  counts_against_cooldown boolean not null default true,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint manager_pulse_runs_season_window check (season_to >= season_from),
  constraint manager_pulse_runs_counts_sane check (
    leagues_total >= 0 and leagues_done >= 0 and leagues_failed >= 0
  )
);

comment on table public.manager_pulse_runs is
  'One row per Manager Pulse lookup. Doubles as the per-user cooldown ledger (measured from the newest row requested_at), the progress source for the page bar, and the observability record for /admin/manager-pulse/runs. Owner-readable, service_role-writable.';

-- The cooldown lookup: newest CHARGEABLE row for one user. Partial, because a
-- free run is invisible to the limit and there is no reason to index it here.
create index if not exists manager_pulse_runs_cooldown_idx
  on public.manager_pulse_runs (user_id, requested_at desc)
  where counts_against_cooldown;

-- Every run for one user, for the page's "your recent lookups" read.
create index if not exists manager_pulse_runs_user_idx
  on public.manager_pulse_runs (user_id, requested_at desc);

-- The admin runs page: newest first, filterable by status.
create index if not exists manager_pulse_runs_status_idx
  on public.manager_pulse_runs (status, requested_at desc);

-- "Is a run already in flight for this manager" without a full scan.
create index if not exists manager_pulse_runs_subject_idx
  on public.manager_pulse_runs (sleeper_user_id, requested_at desc);

alter table public.manager_pulse_runs enable row level security;

drop policy if exists manager_pulse_runs_service_role_all on public.manager_pulse_runs;
create policy manager_pulse_runs_service_role_all
  on public.manager_pulse_runs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists manager_pulse_runs_select_own on public.manager_pulse_runs;
create policy manager_pulse_runs_select_own
  on public.manager_pulse_runs
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Policies cannot grant what table privileges withhold, so both halves are stated.
revoke all on table public.manager_pulse_runs from anon, authenticated;
grant select on table public.manager_pulse_runs to authenticated;
