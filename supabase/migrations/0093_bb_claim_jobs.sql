-- Migration 0093: bb_claim_jobs (The Beacon Brief queue claim function)
--
-- The plan requires the worker to claim jobs with FOR UPDATE SKIP LOCKED so
-- overlapping 1-minute worker runs never grab the same job (no separate lock).
-- The Supabase JS client cannot express row locking, so this function does the
-- atomic claim: it selects up to p_limit eligible pending jobs (optionally
-- filtered to specific job types), locks them with SKIP LOCKED, flips them to
-- 'processing', and returns the claimed rows.
--
-- SECURITY INVOKER (default): it runs with the caller's privileges and respects
-- beacon_brief_queue RLS, which already blocks anon/authenticated. Execute is
-- additionally restricted to service_role (the worker uses the service-role
-- client). No client-facing path.

create or replace function public.bb_claim_jobs(p_limit integer, p_job_types text[] default null)
returns setof public.beacon_brief_queue
language sql
as $$
  with claimed as (
    select id
    from public.beacon_brief_queue
    where status = 'pending'
      and run_after <= now()
      and (p_job_types is null or job_type = any(p_job_types))
    order by run_after
    for update skip locked
    limit greatest(p_limit, 0)
  )
  update public.beacon_brief_queue q
    set status = 'processing', updated_at = now()
    from claimed
    where q.id = claimed.id
    returning q.*;
$$;

revoke all on function public.bb_claim_jobs(integer, text[]) from public;
revoke all on function public.bb_claim_jobs(integer, text[]) from anon;
revoke all on function public.bb_claim_jobs(integer, text[]) from authenticated;
grant execute on function public.bb_claim_jobs(integer, text[]) to service_role;

comment on function public.bb_claim_jobs(integer, text[]) is
  'Atomically claims up to p_limit pending Beacon Brief queue jobs (FOR UPDATE SKIP LOCKED), optionally filtered by job type, flipping them to processing. service_role execute only.';
