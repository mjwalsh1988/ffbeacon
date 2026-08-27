-- Migration 0222: hoist auth.uid() out of the Draft Tracker's row filters
--
-- The eight owner-scoped policies from 0219 call auth.uid() bare, so Postgres
-- treats it as volatile-per-row and re-runs it for every row it tests. The picks
-- policies pay it worst: reading a draft's picks is a few hundred rows, and
-- clearing the board is a bulk delete over the same set, so a single action can
-- call auth.uid() several hundred times and do the parent lookup as many times
-- again.
--
-- Wrapping it as (select auth.uid()) turns it into an InitPlan the planner
-- evaluates once per statement. This is Supabase's own documented fix and it
-- changes NOTHING about who can see or do what: the predicates are otherwise
-- identical to 0219, character for character.
--
-- Access matrix: unchanged from 0219.

-- ---------------------------------------------------------------------------
-- user_draft_trackers
-- ---------------------------------------------------------------------------
drop policy if exists user_draft_trackers_select_own on public.user_draft_trackers;
create policy user_draft_trackers_select_own on public.user_draft_trackers
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_draft_trackers_insert_own on public.user_draft_trackers;
create policy user_draft_trackers_insert_own on public.user_draft_trackers
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_draft_trackers_update_own on public.user_draft_trackers;
create policy user_draft_trackers_update_own on public.user_draft_trackers
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_draft_trackers_delete_own on public.user_draft_trackers;
create policy user_draft_trackers_delete_own on public.user_draft_trackers
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- user_draft_tracker_picks: ownership still flows through the parent tracker.
-- ---------------------------------------------------------------------------
drop policy if exists user_draft_tracker_picks_select_own on public.user_draft_tracker_picks;
create policy user_draft_tracker_picks_select_own on public.user_draft_tracker_picks
  for select to authenticated
  using (
    exists (
      select 1
      from public.user_draft_trackers t
      where t.id = tracker_id
        and t.user_id = (select auth.uid())
    )
  );

drop policy if exists user_draft_tracker_picks_insert_own on public.user_draft_tracker_picks;
create policy user_draft_tracker_picks_insert_own on public.user_draft_tracker_picks
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.user_draft_trackers t
      where t.id = tracker_id
        and t.user_id = (select auth.uid())
    )
  );

drop policy if exists user_draft_tracker_picks_update_own on public.user_draft_tracker_picks;
create policy user_draft_tracker_picks_update_own on public.user_draft_tracker_picks
  for update to authenticated
  using (
    exists (
      select 1
      from public.user_draft_trackers t
      where t.id = tracker_id
        and t.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.user_draft_trackers t
      where t.id = tracker_id
        and t.user_id = (select auth.uid())
    )
  );

drop policy if exists user_draft_tracker_picks_delete_own on public.user_draft_tracker_picks;
create policy user_draft_tracker_picks_delete_own on public.user_draft_tracker_picks
  for delete to authenticated
  using (
    exists (
      select 1
      from public.user_draft_trackers t
      where t.id = tracker_id
        and t.user_id = (select auth.uid())
    )
  );
