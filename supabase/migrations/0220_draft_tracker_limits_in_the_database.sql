-- Migration 0220: enforce the Draft Tracker's two limits in the database
--
-- WHY THIS EXISTS. Migration 0219 put the row limits in the server action and
-- nowhere else, and the server action is not the only way to write these rows.
-- Every signed-in reader holds the publishable key (it is inlined in the browser
-- bundle, which is correct, it is a public key) and their own JWT, which is a
-- working PostgREST endpoint against their own rows. Row level security is doing
-- its job there: they can only touch what they own. But RLS counts nothing and
-- compares nothing, so writing straight to PostgREST let one account create 40
-- trackers against a stated cap of 25, and attach a pick at team slot 99999 to a
-- draft with one team. Both were measured, not theorised.
--
-- Neither is a cross-user problem. The first is unbounded storage growth; the
-- second is quieter and worse for the person doing it, because the board groups
-- picks by slot, so a pick on a slot that does not exist disappears from every
-- roster while still counting as off the board.
--
-- An invariant that only holds when the write comes through one particular door
-- is not an invariant. These are triggers, so they hold whichever door is used.
-- The checks in app/my-beacon/draft-tracker/actions.ts stay exactly where they
-- are: they are what turns a refusal into a sentence somebody can read.
--
-- WHY THE PICK TRIGGER STAYS QUIET ABOUT A TRACKER IT CANNOT SEE. A BEFORE
-- trigger runs ahead of the RLS WITH CHECK, so raising on a tracker that does
-- not resolve would tell a caller that somebody else's tracker id is real. It
-- returns the row instead and lets RLS refuse it, which keeps "not yours" and
-- "does not exist" indistinguishable, exactly as they are everywhere else in
-- this feature.
--
-- Both functions are SECURITY INVOKER, the default. They only ever read rows the
-- caller already owns, so definer rights would buy nothing and would need the
-- grant hygiene that comes with them.
--
-- Access matrix: unchanged from 0219.

-- ---------------------------------------------------------------------------
-- One account keeps at most 25 saved drafts.
--
-- Must match MAX_TRACKERS_PER_USER in lib/draft-tracker/types.ts. The count is
-- served by idx_user_draft_trackers_user.
-- ---------------------------------------------------------------------------
create or replace function public.user_draft_trackers_enforce_limit()
returns trigger
language plpgsql
as $$
declare
  existing integer;
begin
  select count(*) into existing
  from public.user_draft_trackers
  where user_id = new.user_id;

  if existing >= 25 then
    raise exception 'A draft tracker account may hold at most 25 saved drafts'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists user_draft_trackers_limit on public.user_draft_trackers;
create trigger user_draft_trackers_limit
  before insert on public.user_draft_trackers
  for each row
  execute function public.user_draft_trackers_enforce_limit();

-- ---------------------------------------------------------------------------
-- A pick sits on a team that exists, and a draft holds a plausible number of
-- them.
--
-- 1200 is well clear of any real draft: the largest room this feature sets up is
-- 32 teams, and 32 teams of 30 rounds is 960. It is a backstop against a script,
-- not a rule anybody drafting will meet.
-- ---------------------------------------------------------------------------
create or replace function public.user_draft_tracker_picks_enforce_limits()
returns trigger
language plpgsql
as $$
declare
  slots integer;
  existing integer;
begin
  select team_count into slots
  from public.user_draft_trackers
  where id = new.tracker_id;

  -- Null means the tracker is invisible to this caller. Say nothing and let RLS
  -- refuse the write, so a guessed id learns nothing from the error text.
  if slots is not null and new.team_slot is not null and new.team_slot >= slots then
    raise exception 'That team slot is not in this draft'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    select count(*) into existing
    from public.user_draft_tracker_picks
    where tracker_id = new.tracker_id;

    if existing >= 1200 then
      raise exception 'A single draft may hold at most 1200 picks'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists user_draft_tracker_picks_limits on public.user_draft_tracker_picks;
create trigger user_draft_tracker_picks_limits
  before insert or update on public.user_draft_tracker_picks
  for each row
  execute function public.user_draft_tracker_picks_enforce_limits();
