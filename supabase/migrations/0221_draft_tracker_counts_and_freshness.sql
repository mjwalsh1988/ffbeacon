-- Migration 0221: pick counts as a view, freshness as a trigger, and a bound on
-- the team_names array
--
-- Three things the Draft Tracker was doing in the wrong place.
--
-- 1. COUNTING PICKS BY FETCHING THEM. The saved-drafts list needs two integers
--    per card: how many players are off the board, and how many are on the
--    reader's own team. It was getting them by embedding every pick row of every
--    tracker and counting in JavaScript. With the caps from 0220 that is up to
--    30,000 rows crossing the wire to render fifty numbers. The second number is
--    a FILTERED count against a column on the parent row, which PostgREST cannot
--    express, hence a view.
--
--    security_invoker is what makes this safe: the view runs with the caller's
--    own rights, so the owner-only policies on both base tables still apply and
--    the view cannot become a way around them. Grants are named for all three
--    roles, because revoking from public leaves Supabase's own named grants in
--    place.
--
-- 2. FRESHNESS STAMPED FROM THE APPLICATION. Every pick cost a second round trip
--    whose only job was to write updated_at on the parent, on the one code path
--    that has a draft clock running against it. A trigger does it inside the
--    same statement, so a pick is one round trip again. It also means the stamp
--    is right whoever writes the pick, rather than only when the write came
--    through the server action.
--
--    The list orders by updated_at now (see lib/draft-tracker/store.ts), which is
--    what the card has always claimed to show: a draft somebody is in the middle
--    of should sit above one they have not opened since March.
--
-- 3. team_names WAS ONLY SHAPE-CHECKED. 0219 asserted it is a jsonb array and
--    nothing else, so a direct PostgREST write could store an array of any
--    length holding strings of any size. The application trims to the team count
--    and to 40 characters an entry; the database now bounds it too, at the
--    largest room the feature offers and a byte length no honest set of 32 names
--    can reach.
--
-- Access matrix:
--   user_draft_tracker_pick_counts (view, security_invoker)
--     anon          : NONE
--     authenticated : SELECT, and only rows whose tracker they own (inherited
--                     from the base tables' policies)
--     service_role  : SELECT

-- ---------------------------------------------------------------------------
-- 1. The two counts, computed in the database.
-- ---------------------------------------------------------------------------
drop view if exists public.user_draft_tracker_pick_counts;
create view public.user_draft_tracker_pick_counts
with (security_invoker = true) as
select
  t.id as tracker_id,
  count(p.id) as pick_count,
  count(p.id) filter (where p.team_slot = t.my_team_slot) as my_pick_count
from public.user_draft_trackers t
left join public.user_draft_tracker_picks p on p.tracker_id = t.id
group by t.id;

revoke all on public.user_draft_tracker_pick_counts from public;
revoke all on public.user_draft_tracker_pick_counts from anon;
revoke all on public.user_draft_tracker_pick_counts from authenticated;
grant select on public.user_draft_tracker_pick_counts to authenticated;
grant select on public.user_draft_tracker_pick_counts to service_role;

-- ---------------------------------------------------------------------------
-- 2. A pick touches its draft.
--
-- AFTER, so it never blocks the pick itself, and it reads OLD on delete because
-- that is the only row still naming the tracker. Invoker rights: the caller owns
-- the tracker, so the owner-only UPDATE policy already permits this.
-- ---------------------------------------------------------------------------
create or replace function public.user_draft_tracker_picks_touch_parent()
returns trigger
language plpgsql
as $$
begin
  update public.user_draft_trackers
  set updated_at = now()
  where id = coalesce(new.tracker_id, old.tracker_id);
  return null;
end;
$$;

drop trigger if exists user_draft_tracker_picks_touch on public.user_draft_tracker_picks;
create trigger user_draft_tracker_picks_touch
  after insert or update or delete on public.user_draft_tracker_picks
  for each row
  execute function public.user_draft_tracker_picks_touch_parent();

-- ---------------------------------------------------------------------------
-- 3. Bound the team_names array.
--
-- 32 matches the largest team_count the check on that column already allows.
-- 2000 bytes is far above 32 names of 40 characters plus the JSON punctuation,
-- so no real set of names can meet it.
-- ---------------------------------------------------------------------------
alter table public.user_draft_trackers
  drop constraint if exists user_draft_trackers_team_names_bounded;
alter table public.user_draft_trackers
  add constraint user_draft_trackers_team_names_bounded
  check (
    jsonb_typeof(team_names) = 'array'
    and jsonb_array_length(team_names) <= 32
    and length(team_names::text) <= 2000
  );
