-- Migration 0205: the On The Clock cache prune stops deleting drafts
--
-- WHY
-- 0113 built cleanup_on_the_clock_cache as a TTL prune over on_the_clock_draft_cache,
-- and 0185 extended it to the projection and pulse caches. Neither was ever wired to a
-- cron, so the draft deletion has never actually run in production. Wiring it revealed
-- that the draft half of it is wrong for this product, in two separate ways.
--
-- A drafted pick is DATA, not a cache entry. on_the_clock_draft_cache and its pick rows
-- are one of the two places FF Beacon observes real drafts happening (League Pulse is the
-- other), and lib/draft-selections.ts already treats every pick this room sees as a data
-- point for the Beacon Steals market model. Deleting a draft a week after it finished
-- throws away the observation, and no future sync brings it back: Sleeper serves the
-- picks again, but the moment we watched them land is gone.
--
-- "Abandoned" was also the wrong word for an unfinished draft. Someone can open a draft
-- that completed months ago, sync the remainder, and lock its snapshot for the first
-- time. A 24-hour TTL on non-complete drafts deleted exactly the rows that flow was
-- built to rescue, and it deleted them fastest for the slow multi-day dynasty drafts
-- where an eight-hour pick clock makes a day of silence completely normal.
--
-- WHAT CHANGED
-- The function no longer touches on_the_clock_draft_cache or on_the_clock_pick_cache at
-- all. Nothing in this system deletes a draft any more, and the capability is removed
-- rather than merely left uncalled, so a future caller cannot reintroduce it by passing
-- a shorter window. The two retention arguments are dropped with it; the old three-arg
-- signature is DROPped rather than replaced, because leaving it in place would leave the
-- draft deletion one call away.
--
-- What it still prunes is genuinely disconnected from any draft:
--
--   on_the_clock_projection_cache   Not draft data. A row is a sweep of weekly
--                                   projections keyed on a league's SCORING SHAPE, the
--                                   season and a week window, and it is rebuilt on
--                                   demand from projections we still hold. It is also
--                                   the one that actually grows without bound: the
--                                   signature comes from user-controlled scoring
--                                   settings and each distinct shape writes about a
--                                   megabyte (see 0185). Age-pruned at three times
--                                   PROJECTION_CACHE_TTL_MS, so a row is only dropped
--                                   well after it stopped being served.
--
--   on_the_clock_pulse_cache        Orphans only, unchanged from 0185: rows whose draft
--                                   is already gone. A pulse row is meaningless without
--                                   its draft and the FK was never declared. With drafts
--                                   no longer deleted this should find nothing, which is
--                                   the point of leaving it in.
--
-- The return stays jsonb so an operator can see the breakdown, and reports drafts: 0
-- explicitly rather than dropping the key, so a reader of the cron log can tell this
-- function chose not to delete drafts from a version that simply found none to delete.
--
-- ABSOLUTE: cleanup is deletion ONLY, and now deletes nothing that represents an
-- observed draft. It never recomputes anything per draft or per league, matching the
-- League Pulse cron rule.
--
-- ACCESS MATRIX
--   anon           no EXECUTE
--   authenticated  no EXECUTE
--   service_role   EXECUTE
-- Both tables it touches are service-role only in their own migrations (0181, 0182).
-- SECURITY DEFINER with a pinned search_path, and the revokes name all three roles
-- because `revoke ... from public` leaves Supabase's own named grants in place.
--
-- Wired to /api/cron/recalculate-derived, alongside the rate-limit and BEAM log prunes.

drop function if exists public.cleanup_on_the_clock_cache(int, int, int);

create or replace function public.cleanup_on_the_clock_cache(
  p_projection_retention_hours int default 72
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_projections integer := 0;
  v_pulses integer := 0;
begin
  with del as (
    delete from public.on_the_clock_projection_cache
     where computed_at < now() - make_interval(hours => p_projection_retention_hours)
    returning 1
  )
  select count(*) from del into v_projections;

  -- Orphans only. With drafts retained permanently this should be empty; it stays as a
  -- sweep for rows left behind by a manual deletion.
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
    'drafts', 0,
    'projections', v_projections,
    'pulses', v_pulses
  );
end;
$$;

revoke all on function public.cleanup_on_the_clock_cache(int) from public;
revoke all on function public.cleanup_on_the_clock_cache(int) from anon;
revoke all on function public.cleanup_on_the_clock_cache(int) from authenticated;
grant execute on function public.cleanup_on_the_clock_cache(int) to service_role;

comment on function public.cleanup_on_the_clock_cache(int) is
  'Deletion-only prune for the On The Clock caches that are NOT draft data: projection-cache rows past the projection retention window, and pulse-cache rows whose draft no longer exists. Never deletes drafts or picks: those are observed draft data, retained permanently, and a completed draft can still be opened and snapshotted later. Returns {drafts, projections, pulses} with drafts always 0. service_role EXECUTE only. Called by /api/cron/recalculate-derived.';
