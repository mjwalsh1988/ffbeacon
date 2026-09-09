-- Migration 0280: enforce the bookmark cap in the database, and drop an index
-- that was not earning its keep.
--
-- Both changes come out of the review of 0279. Neither alters the access
-- matrix, which stands exactly as 0279 documents it:
--   user_bookmarks
--     anon          : NONE
--     authenticated : SELECT/INSERT/UPDATE/DELETE OWN rows only
--     service_role  : ALL
--
-- 1. THE CAP IS NOW A DATABASE RULE, NOT ONLY AN APPLICATION ONE.
--
-- `addBookmark` counts the caller's rows and refuses at 40. That is a read
-- followed by a write, so two requests in flight together can both see 39 and
-- both insert. The overshoot was bounded and self-correcting, but above the cap
-- the read path (which is itself capped at 40) stops seeing every row, and the
-- reorder then writes positions that collide with rows it cannot see. A trigger
-- closes it where the race actually happens.
--
-- SECURITY DEFINER with a pinned search_path, and it counts only the row's OWN
-- user_id, so it reads nothing the caller could not already read and cannot be
-- used to probe anyone else's row count: the count it takes is of the user_id
-- being inserted, which for any caller other than service_role is their own by
-- the insert policy's WITH CHECK.
--
-- 2. THE (user_id, sort_order) INDEX IS REDUNDANT.
--
-- Measured with EXPLAIN ANALYZE on the live project: the planner uses it for
-- the user_id equality only, then sorts anyway, because the read breaks ties on
-- created_at and a bitmap scan discards ordering regardless. The unique index
-- behind the (user_id, path) constraint already leads with user_id and serves
-- the same filter. Keeping it meant a third index to maintain on a table whose
-- entire write pattern is updating sort_order, which is exactly the column it
-- indexes, so every reorder was blocked from a HOT update for no read benefit.
-- Forty rows per reader: the sort is free either way.

create or replace function public.enforce_user_bookmark_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing integer;
begin
  select count(*) into existing
  from public.user_bookmarks
  where user_id = new.user_id;

  if existing >= 40 then
    raise exception 'bookmark limit reached'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_user_bookmark_limit() is
  'Caps one reader at 40 bookmarks. Mirrors MAX_BOOKMARKS in lib/bookmarks/types.ts; change both together.';

-- Not executable by a client. The trigger fires as part of the INSERT
-- regardless of who may call the function directly, so no role needs EXECUTE.
-- Named explicitly rather than relying on `revoke from public`, which leaves
-- Supabase's own grants to anon and authenticated in place.
revoke all on function public.enforce_user_bookmark_limit() from public;
revoke all on function public.enforce_user_bookmark_limit() from anon;
revoke all on function public.enforce_user_bookmark_limit() from authenticated;

drop trigger if exists trg_user_bookmarks_limit on public.user_bookmarks;
create trigger trg_user_bookmarks_limit
  before insert on public.user_bookmarks
  for each row
  execute function public.enforce_user_bookmark_limit();

drop index if exists public.idx_user_bookmarks_user_order;
