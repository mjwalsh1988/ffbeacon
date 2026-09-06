-- Migration 0263: claim_league_sync_jobs interleaves owners
--
-- The queue was first in, first out across the whole site, so one 250-league
-- Manager Pulse run held every Sync all press and every other lookup behind it
-- for its full duration. Ordering by each job's rank WITHIN its own owner (a
-- Manager Pulse run or a Sync all request) and then by age gives every owner
-- its next league in turn: a ten-league lookup queued behind a hundred-league
-- one now finishes in about the time it would have taken alone.
--
-- Grants unchanged from 0172: service_role EXECUTE only.
-- Rollback: re-apply the function body from migration 0172.

create or replace function public.claim_league_sync_jobs(p_limit int)
returns setof public.league_sync_jobs
language sql
set search_path = public, pg_temp
as $$
  with ranked as (
    select id,
           created_at,
           row_number() over (
             partition by coalesce(manager_run_id, request_id)
             order by run_after, created_at
           ) as rank_in_owner
    from public.league_sync_jobs
    where status = 'pending'
      and run_after <= now()
  ),
  claimed as (
    select r.id
    from ranked r
    join public.league_sync_jobs j on j.id = r.id
    order by r.rank_in_owner, r.created_at
    for update of j skip locked
    limit greatest(coalesce(p_limit, 0), 0)
  )
  update public.league_sync_jobs j
     set status = 'processing',
         updated_at = now()
    from claimed
   where j.id = claimed.id
  returning j.*;
$$;

comment on function public.claim_league_sync_jobs(int) is
  'Atomically claims up to p_limit due league_sync_jobs (FOR UPDATE SKIP LOCKED) and flips them to processing, interleaving owners so one large request cannot hold every other one behind it. SECURITY INVOKER: runs as the caller and respects league_sync_jobs RLS. service_role-only EXECUTE.';

revoke all on function public.claim_league_sync_jobs(int) from public;
revoke execute on function public.claim_league_sync_jobs(int) from anon, authenticated;
grant execute on function public.claim_league_sync_jobs(int) to service_role;

-- The cross-user link in enqueue_manager_pulse_capture (0265) looks up an
-- in-flight job by league alone.
create index if not exists league_sync_jobs_league_active_idx
  on public.league_sync_jobs (sleeper_league_id, created_at)
  where status in ('pending', 'processing');
