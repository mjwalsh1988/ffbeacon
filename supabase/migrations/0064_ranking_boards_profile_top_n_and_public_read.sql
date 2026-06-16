-- Migration 0064: profile_top_n + public read for featured ranking boards
--
-- Two additions so Signal profiles can render featured boards BY REFERENCE
-- (no copy/fork of board data):
--   1. profile_top_n on user_ranking_boards: how many ranked players to show in
--      the board's profile summary (null = UI default: 10 for the primary board,
--      5 for secondary). Used alongside the profile_visible/_is_primary/_sort
--      flags from migration 0058.
--   2. Public read for featured boards and their players, gated on the OWNER's
--      Signal being published + public + not hidden AND the board being
--      profile_visible. This is the ONLY path by which anon can read
--      user_ranking_boards; all other boards stay owner-only (the migration 0056
--      owner policies are left intact and simply OR with this one).
--
-- PERFORMANCE: the public profile page wraps these reads in unstable_cache keyed
-- by board id + updated_at, so the EXISTS subquery below executes only on a cache
-- miss, never per anonymous request.
--
-- Access matrix delta:
--   user_ranking_boards / user_ranking_board_players
--     anon          : SELECT only when board.profile_visible AND the owner's
--                     Signal is published+public+not-hidden
--     authenticated : prior owner-only policies (0056) UNCHANGED, plus the same
--                     public read above
--     service_role  : ALL (unchanged)

alter table public.user_ranking_boards
  add column if not exists profile_top_n integer
    check (profile_top_n is null or profile_top_n between 1 and 100);

drop policy if exists user_ranking_boards_select_profile_public on public.user_ranking_boards;
create policy user_ranking_boards_select_profile_public on public.user_ranking_boards
  for select to anon, authenticated
  using (
    profile_visible = true
    and exists (
      select 1 from public.signals s
      where s.user_id = user_ranking_boards.user_id
        and s.status = 'published'
        and s.visibility = 'public'
        and s.hidden = false
    )
  );

drop policy if exists user_ranking_board_players_select_profile_public on public.user_ranking_board_players;
create policy user_ranking_board_players_select_profile_public on public.user_ranking_board_players
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.user_ranking_boards b
      join public.signals s on s.user_id = b.user_id
      where b.id = user_ranking_board_players.board_id
        and b.profile_visible = true
        and s.status = 'published'
        and s.visibility = 'public'
        and s.hidden = false
    )
  );
