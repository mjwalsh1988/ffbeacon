-- Migration 0277: league_sync_tick, one round trip for the worker's claim loop
--
-- PERF-T060. An idle league-sync-worker tick (the common case: the Sync all
-- queue is empty almost all of the time) cost about twelve database requests
-- a minute: a cron_runs insert, two settings reads, a lease acquire, a lease
-- renew, a stale-job reap, a computing-runs read, a claim RPC, a pending-jobs
-- count, a lease release, and a cron_runs update. 5,763 lease acquisitions,
-- 3,102 league_sync_jobs reads, 3,035 settings reads and 6,656 cron_runs
-- writes a day, for a queue that is empty almost every time.
--
-- This migration folds three of those round trips (acquire/renew the lease,
-- claim the next batch, count what is still pending) into one function, so
-- lib/league-bulk-sync.ts runLeagueSyncWorker's claim loop makes one RPC call
-- per iteration instead of two, and app/api/cron/league-sync-worker/route.ts
-- no longer needs its own separate pending-count query afterward.
--
-- COMPOSES existing functions, does not reimplement them. The lease logic
-- stays in try_acquire_league_sync_lease (migration 0264) exactly as it is;
-- the claim logic stays in claim_league_sync_jobs (migration 0263) exactly
-- as it is. This function calls both, in order, plus a count, and is the
-- only new logic here.
--
-- Access matrix: service_role EXECUTE only, matching try_acquire_league_sync_lease
-- and release_league_sync_lease (0264) and claim_league_sync_jobs (0263).
-- SECURITY DEFINER, set search_path = public, pg_temp, revoked from public,
-- anon and authenticated by name, granted to service_role. Nobody else can
-- call it, same as the functions it composes.
--
-- CONTRACT: if the lease cannot be acquired (another pass already holds it),
-- this function returns NO ROWS. The caller must treat a zero-row result
-- exactly like today's "lease held" branch: stop, do nothing else this tick.
-- A row IS returned when the lease is acquired but zero jobs are pending
-- (job is null, pending_count is the real count), so the caller can always
-- tell "another holder is draining" (no rows) apart from "I am draining and
-- there is nothing to do right now" (one row, job null).
--
-- Rollback: drop function if exists public.league_sync_tick(text, int, int);

create or replace function public.league_sync_tick(
  p_holder text,
  p_lease_seconds int,
  p_limit int
)
returns table (job public.league_sync_jobs, pending_count int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acquired boolean;
  v_pending int;
  v_claimed public.league_sync_jobs[];
begin
  -- Acquire or renew p_holder's hold on the single-drainer lease. False means
  -- some other pass already holds it: return no rows and do nothing further,
  -- exactly what the caller does today when its own pre-check fails.
  v_acquired := public.try_acquire_league_sync_lease(p_holder, p_lease_seconds);
  if not v_acquired then
    return;
  end if;

  -- array_agg forces claim_league_sync_jobs to run exactly once, fully,
  -- before anything below reads league_sync_jobs again. Two separate
  -- statements rather than one combined query so the pending count below is
  -- guaranteed to run AFTER the claim's update, not concurrently with it:
  -- Postgres does not promise an execution order between two independent
  -- CTEs in one statement, and counting pending jobs before the claim had
  -- run would count the very jobs about to be claimed.
  select array_agg(c) into v_claimed from public.claim_league_sync_jobs(p_limit) c;

  select count(*)::int into v_pending
    from public.league_sync_jobs
   where status = 'pending'
     and run_after <= now();

  if v_claimed is null or array_length(v_claimed, 1) is null then
    return query select null::public.league_sync_jobs, v_pending;
  else
    return query select c, v_pending from unnest(v_claimed) as c;
  end if;
end;
$$;

comment on function public.league_sync_tick(text, int, int) is
  'PERF-T060: one round trip for the league-sync-worker claim loop. Acquires or renews p_holder''s lease (try_acquire_league_sync_lease), claims up to p_limit due jobs (claim_league_sync_jobs) and returns the still-pending count, all in one call. Returns NO ROWS when the lease could not be acquired; returns one row with job=null when the lease was acquired but nothing was pending. SECURITY DEFINER so the invoker-rights claim_league_sync_jobs it calls runs as this function''s owner. service_role-only EXECUTE.';

revoke all on function public.league_sync_tick(text, int, int) from public;
revoke execute on function public.league_sync_tick(text, int, int) from anon, authenticated;
grant execute on function public.league_sync_tick(text, int, int) to service_role;
