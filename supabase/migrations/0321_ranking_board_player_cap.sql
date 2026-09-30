-- Migration 0321: a ranking board holds at most 2,000 players, in the database.
--
-- The app caps a board at MAX_BOARD_PLAYERS (2,000, lib/ranking-boards.ts), but
-- `authenticated` can insert into user_ranking_board_players directly under
-- its owner policy, and nothing in the table stopped a board from growing past
-- that. The nightly community merge (lib/community-rankings/) turns a board of
-- n players into about n squared statements, so one oversized board is enough
-- to stall or crash the job for every format. The job now skips such a board
-- on its own; this makes the limit true at the source as well.
--
-- Two AFTER ... FOR EACH STATEMENT triggers with transition tables, one for
-- INSERT and one for UPDATE (a trigger with a transition table can name only
-- one event). Each counts the boards the statement touched once, rather than
-- once per row, so a 2,000 row save costs one grouped count. The touched boards
-- are locked FOR NO KEY UPDATE first, which serialises two concurrent writers to
-- the same board without conflicting with the FOR KEY SHARE lock the foreign key
-- check already took, so the count cannot be raced past the cap.
--
-- SECURITY DEFINER so the count sees every row of the board regardless of the
-- caller's RLS. Applies to every role, service role included: the app never
-- writes more than 2,000 rows to one board (run-store.ts deletes the removed
-- players before it upserts the rest).
--
-- Safe to apply BEFORE the code deploys. Verified no current board exceeds it.
--
-- Access matrix (unchanged)
--   user_ranking_board_players: public SELECT per existing policies, owner
--   INSERT/UPDATE/DELETE per existing policies, service_role ALL. The trigger
--   adds a size limit, not a permission.

create or replace function public.user_ranking_board_players_enforce_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board uuid;
begin
  perform 1
    from public.user_ranking_boards b
   where b.id in (select distinct n.board_id from new_rows n)
   order by b.id
     for no key update;

  select c.board_id into v_board
    from public.user_ranking_board_players c
   where c.board_id in (select distinct n.board_id from new_rows n)
   group by c.board_id
  having count(*) > 2000
   limit 1;

  if v_board is not null then
    raise exception 'board_too_large: a ranking board holds at most 2000 players'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

revoke all on function public.user_ranking_board_players_enforce_cap() from public, anon, authenticated;

drop trigger if exists trg_user_ranking_board_players_cap_insert on public.user_ranking_board_players;
create trigger trg_user_ranking_board_players_cap_insert
  after insert on public.user_ranking_board_players
  referencing new table as new_rows
  for each statement execute function public.user_ranking_board_players_enforce_cap();

drop trigger if exists trg_user_ranking_board_players_cap_update on public.user_ranking_board_players;
create trigger trg_user_ranking_board_players_cap_update
  after update on public.user_ranking_board_players
  referencing new table as new_rows
  for each statement execute function public.user_ranking_board_players_enforce_cap();
