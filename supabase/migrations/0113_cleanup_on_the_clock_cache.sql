-- Migration 0113: cleanup_on_the_clock_cache (deletion-only TTL function)
--
-- Lightweight cache pruning for On The Clock. Deletes:
--   * completed drafts (draft_status = 'complete') whose updated_at is older than the
--     "completed draft cache retention" window (default 7 days / 168h), and
--   * non-complete drafts whose last activity (last_synced_at, or created_at if a row
--     was created by a claim but never completed) is older than the "active draft cache
--     TTL" (default 24h) -- abandoned / stale drafts.
-- Pick rows cascade-delete with their parent draft row (FK on delete cascade), so this
-- function only needs to touch on_the_clock_draft_cache.
--
-- ABSOLUTE: cleanup is deletion ONLY. It NEVER recomputes anything per draft/league
-- (matches the League Pulse cron rule). The caller passes the admin-configured windows.
--
-- SECURITY DEFINER + service_role-only EXECUTE. NOT wired to any cron in this migration;
-- the plan defers cron wiring. A future /api/cron/cleanup-on-the-clock (or the existing
-- recalculate-derived cron) can call select public.cleanup_on_the_clock_cache(...).
-- Returns the number of draft rows deleted (picks cascade).

create or replace function public.cleanup_on_the_clock_cache(
  p_completed_retention_hours int default 168,
  p_active_ttl_hours int default 24
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  with del as (
    delete from public.on_the_clock_draft_cache
     where (
             draft_status = 'complete'
             and updated_at < now() - make_interval(hours => p_completed_retention_hours)
           )
        or (
             coalesce(draft_status, '') <> 'complete'
             and coalesce(last_synced_at, created_at)
                 < now() - make_interval(hours => p_active_ttl_hours)
           )
    returning 1
  )
  select count(*) from del into v_deleted;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_on_the_clock_cache(int, int) from public;
grant execute on function public.cleanup_on_the_clock_cache(int, int) to service_role;

comment on function public.cleanup_on_the_clock_cache(int, int) is
  'Deletion-only TTL prune for On The Clock cache: removes completed drafts past the retention window and non-complete drafts past the active TTL (picks cascade). Returns the count of draft rows deleted. service_role EXECUTE only; NOT cron-wired here. Never recomputes per draft/league.';
