-- Migration 0185: On The Clock cache eviction covers the two new cache tables
--
-- WHY
-- 0181 and 0182 added on_the_clock_projection_cache and on_the_clock_pulse_cache.
-- Neither has ever been swept. The projection cache is the one that matters:
-- `scoring_signature` is derived from a league's OWN scoring_settings, which a
-- user controls, so each distinct scoring shape forces a cold build and writes a
-- roughly 1 MB row that nothing ever deletes. PROJECTION_CACHE_TTL_MS controls
-- STALENESS, not deletion, so a stale row keeps its megabyte indefinitely. A
-- thousand crafted leagues is about a gigabyte retained forever.
--
-- Getting a draft into the cache at all is throttled by the sync route's IP
-- budget, and reading it is throttled by the pulse route's own CPU budget, so
-- this is slow to exploit. It is still unbounded, which is the part worth
-- fixing.
--
-- WHAT CHANGED
-- cleanup_on_the_clock_cache now prunes three tables instead of one and returns
-- a jsonb breakdown instead of a bare integer, so an operator can see which
-- table the rows came from. The 0113 signature is dropped first: a return type
-- cannot be changed by CREATE OR REPLACE, and nothing in the codebase calls it
-- (verified: the only reference is the generated type in lib/database.types.ts).
--
--   on_the_clock_draft_cache        unchanged from 0113 (completed-draft
--                                   retention, then abandoned-draft TTL). Pick
--                                   rows still cascade with their draft.
--   on_the_clock_projection_cache   computed_at older than the projection
--                                   retention window. Default 72 hours, three
--                                   times PROJECTION_CACHE_TTL_MS, so a row is
--                                   only dropped well after it stopped being
--                                   served. Rebuilding one is a single sweep
--                                   behind an in-process memo, not a user-facing
--                                   failure.
--   on_the_clock_pulse_cache        rows whose draft is gone. A pulse row is
--                                   meaningless without its draft, and the FK
--                                   was never declared, so these outlived the
--                                   drafts they described.
--
-- ABSOLUTE: cleanup is deletion ONLY. It never recomputes anything per draft or
-- per league, matching the League Pulse cron rule.
--
-- ACCESS MATRIX
--   anon           no EXECUTE
--   authenticated  no EXECUTE
--   service_role   EXECUTE
-- The three tables it touches are service-role only in their own migrations
-- (0181, 0182) or already policied (0113's parent). SECURITY DEFINER with a
-- pinned search_path, and the grant is named for all three roles because
-- `revoke ... from public` leaves Supabase's own named grants in place.
--
-- NOT cron-wired here, deliberately: same as 0113. A future
-- /api/cron/cleanup-on-the-clock calls
-- `select public.cleanup_on_the_clock_cache(...)`.

drop function if exists public.cleanup_on_the_clock_cache(int, int);

create or replace function public.cleanup_on_the_clock_cache(
  p_completed_retention_hours int default 168,
  p_active_ttl_hours int default 24,
  p_projection_retention_hours int default 72
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_drafts integer := 0;
  v_projections integer := 0;
  v_pulses integer := 0;
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
  select count(*) from del into v_drafts;

  with del as (
    delete from public.on_the_clock_projection_cache
     where computed_at < now() - make_interval(hours => p_projection_retention_hours)
    returning 1
  )
  select count(*) from del into v_projections;

  -- Orphans only. A pulse row for a live draft is the cheap half of the cache
  -- and is keyed on the pick count, so it is replaced rather than accumulated.
  with del as (
    delete from public.on_the_clock_pulse_cache p
     where not exists (
       select 1
         from public.on_the_clock_draft_cache d
        where d.sleeper_draft_id = p.sleeper_draft_id
     )
    returning 1
  )
  select count(*) from del into v_pulses;

  return jsonb_build_object(
    'drafts', v_drafts,
    'projections', v_projections,
    'pulses', v_pulses
  );
end;
$$;

revoke all on function public.cleanup_on_the_clock_cache(int, int, int) from public;
revoke all on function public.cleanup_on_the_clock_cache(int, int, int) from anon;
revoke all on function public.cleanup_on_the_clock_cache(int, int, int) from authenticated;
grant execute on function public.cleanup_on_the_clock_cache(int, int, int) to service_role;

comment on function public.cleanup_on_the_clock_cache(int, int, int) is
  'Deletion-only prune for the On The Clock caches: completed drafts past retention and abandoned drafts past the active TTL (pick rows cascade), projection-cache rows past the projection retention window, and pulse-cache rows whose draft no longer exists. Returns {drafts, projections, pulses}. service_role EXECUTE only; NOT cron-wired here. Never recomputes per draft or per league.';
