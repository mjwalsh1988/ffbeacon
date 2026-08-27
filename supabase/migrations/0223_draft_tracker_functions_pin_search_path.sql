-- Migration 0223: pin search_path on the three Draft Tracker trigger functions
--
-- Supabase's database linter flags a function with a role-mutable search_path
-- (lint 0011). These three are SECURITY INVOKER, so the practical risk is small,
-- but a resolvable name inside a function body is a name somebody else's
-- search_path gets a say in, and the fix costs one line each.
--
-- All three already schema-qualify every table they touch, so setting the path
-- to empty changes no behaviour. Anything that stopped resolving would fail
-- loudly on the next write rather than quietly resolving somewhere else, which
-- is the point of doing it this way round.
--
-- Bodies are otherwise identical to 0220 and 0221.

create or replace function public.user_draft_trackers_enforce_limit()
returns trigger
language plpgsql
set search_path = ''
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

create or replace function public.user_draft_tracker_picks_enforce_limits()
returns trigger
language plpgsql
set search_path = ''
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

create or replace function public.user_draft_tracker_picks_touch_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.user_draft_trackers
  set updated_at = now()
  where id = coalesce(new.tracker_id, old.tracker_id);
  return null;
end;
$$;
