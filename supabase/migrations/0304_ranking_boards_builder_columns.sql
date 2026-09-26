-- Migration 0304: ranking boards learn their format, their seed, defenders and
-- the community opt-out (Beacon Ranker, docs/ranking-boards/board-builder-plan.md
-- sections 5.1, 8, 9.1 and 9.2).
--
-- user_ranking_boards
--   scope               widened to DL, LB, DB and 'defense' (every defender).
--                       'overall' keeps its meaning: every OFFENSIVE position.
--   includes_defenders  an overall board that also ranks defenders. A flag on
--                       'overall' rather than an eighth scope value, so the
--                       community merge and "one board per account per
--                       (format, scope)" treat both as one scope with a wider
--                       pool. Only meaningful on 'overall' (CHECK below).
--   format_config_id    what the board MEANS: drives the community merge, the
--                       "vs FF Beacon" comparison and the finishes column.
--                       Null on boards made before this migration.
--   seed_source_slug    provenance only: the source_registry slug the seed came
--                       from. Deliberately not a foreign key, because a source
--                       later retired must not delete or rewrite a board.
--   community_opt_out   the quiet per-board switch. Off by default: every board
--                       counts unless its owner says otherwise.
--   left_off_player_ids players the owner chose to LEAVE OFF during a run. The
--                       merge reads these as a judgement ("everyone on the board
--                       beats him"), which a player merely past the depth is
--                       not. The plan drew these as player rows with a null
--                       rank; they are an array on the board instead, because
--                       every existing reader of user_ranking_board_players
--                       (the player counts, the public Top-N, the editor) counts
--                       and orders those rows, and each would have needed a
--                       filter. Ids of players later deleted are harmless: the
--                       merge ignores ids it cannot resolve.
--
-- Access matrix: UNCHANGED from 0056, 0058, 0064 and 0274. The new columns live
-- on already-protected tables; no policy is added or altered.
--   user_ranking_boards / user_ranking_board_players
--     anon          : SELECT only via the profile-public policy (0064)
--     authenticated : owner-only CRUD (0056, initplan form 0274) plus 0064
--     service_role  : ALL

alter table public.user_ranking_boards
  drop constraint if exists user_ranking_boards_scope_check;
alter table public.user_ranking_boards
  add constraint user_ranking_boards_scope_check
  check (scope in ('overall', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'defense'));

alter table public.user_ranking_boards
  add column if not exists includes_defenders boolean not null default false,
  add column if not exists format_config_id uuid
    references public.format_configs(id) on delete set null,
  add column if not exists seed_source_slug text
    check (seed_source_slug is null or seed_source_slug ~ '^[a-z0-9_-]{1,40}$'),
  add column if not exists community_opt_out boolean not null default false,
  add column if not exists left_off_player_ids uuid[] not null default '{}'::uuid[]
    check (cardinality(left_off_player_ids) <= 2000);

alter table public.user_ranking_boards
  drop constraint if exists chk_ranking_board_defenders_overall_only;
alter table public.user_ranking_boards
  add constraint chk_ranking_board_defenders_overall_only
  check (not includes_defenders or scope = 'overall');

-- The nightly community build reads boards by format, one format at a time.
create index if not exists idx_user_ranking_boards_format
  on public.user_ranking_boards(format_config_id, scope)
  where format_config_id is not null and not community_opt_out;
