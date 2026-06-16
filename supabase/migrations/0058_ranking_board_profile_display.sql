-- Migration 0058: profile-display controls for user ranking boards
--
-- Adds the ability for a user to feature their personal ranking boards on their
-- (future) public profile. Three additions to user_ranking_boards:
--   profile_visible    : whether this board shows on the user's public profile
--                        (off by default, the user opts each board in).
--   profile_is_primary : marks the ONE headline board on the profile. The rest
--                        of the featured boards are "secondary" boards.
--   profile_sort       : display order among the featured secondary boards
--                        (lower shows first). Ignored for the primary board and
--                        for non-featured boards.
--
-- Invariants enforced at the database layer:
--   * A board can only be primary if it is also visible
--     (chk_ranking_board_primary_visible).
--   * At most one primary board per user
--     (uniq_user_ranking_boards_primary, a partial unique index).
--
-- Access matrix is UNCHANGED from migration 0056 (these are still owner-only
-- user-owned rows): authenticated users read/write only their own boards,
-- service_role has full access, anon has none. No new policies needed because
-- the new columns live on the already-protected table.

alter table public.user_ranking_boards
  add column if not exists profile_visible boolean not null default false,
  add column if not exists profile_is_primary boolean not null default false,
  add column if not exists profile_sort integer not null default 0;

-- A primary board must be visible on the profile.
alter table public.user_ranking_boards
  drop constraint if exists chk_ranking_board_primary_visible;
alter table public.user_ranking_boards
  add constraint chk_ranking_board_primary_visible
  check (not profile_is_primary or profile_visible);

-- At most one primary board per user.
create unique index if not exists uniq_user_ranking_boards_primary
  on public.user_ranking_boards(user_id)
  where profile_is_primary;

-- Primary read path for the profile: a user's featured boards in display order.
create index if not exists idx_user_ranking_boards_profile
  on public.user_ranking_boards(user_id, profile_sort)
  where profile_visible;
