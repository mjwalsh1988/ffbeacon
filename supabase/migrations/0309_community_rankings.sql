-- Migration 0309: community rankings (Beacon Ranker, plan section 9)
--
-- Every saved board that counts is merged, nightly, into one ranking per
-- format by a pairwise strength fit (lib/community-rankings/). These two tables
-- are the result. Derived data: no metadata column, per the Data Architecture
-- rule for pre-calculated tables; their provenance is the nightly job
-- (/api/cron/community-rankings).
--
-- PRIVACY. Nothing here identifies a board or a person: no user id, no board
-- id, no handle. A private board contributes to the aggregate only. A player
-- is listed only once minBoardsPerPlayer boards rank him (5 by default), so a
-- row can never be one reader's opinion restated.
--
-- community_rankings
--   Shaped to map onto `rankings` (overall_rank, position_rank) so that
--   offering the community board as a source later (plan 9.4, off at launch)
--   is a mapping, not a redesign. Adds the columns a source does not have:
--   strength (the fitted log-strength), boards_count, the connected group the
--   player was fitted in, and previous_rank for movement since the last build.
--   overall_rank is WITHIN the player's group: when nobody has ranked two
--   groups against each other (offense and defense, typically) they are fitted
--   and ranked apart rather than given an invented order between them.
--
-- community_ranking_formats
--   One row per format per build: how many boards counted, whether the format
--   published, and how many players were listed. A format below the threshold
--   still gets a row, so its page can say how many more boards it needs.
--
-- Access matrix (both tables)
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (the nightly job writes)
--   client writes : BLOCKED (no insert/update/delete policy for anon or
--                   authenticated)

create table if not exists public.community_rankings (
  format_config_id uuid not null references public.format_configs(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  position text not null,
  strength double precision not null,
  overall_rank integer not null check (overall_rank >= 1),
  position_rank integer not null check (position_rank >= 1),
  previous_rank integer check (previous_rank is null or previous_rank >= 1),
  boards_count integer not null check (boards_count >= 0),
  group_key text not null default 'all' check (char_length(group_key) between 1 and 40),
  built_at timestamptz not null default now(),
  primary key (format_config_id, player_id)
);

create index if not exists idx_community_rankings_format_rank
  on public.community_rankings(format_config_id, group_key, overall_rank);
create index if not exists idx_community_rankings_player
  on public.community_rankings(player_id);

create table if not exists public.community_ranking_formats (
  format_config_id uuid primary key references public.format_configs(id) on delete cascade,
  eligible_boards integer not null default 0 check (eligible_boards >= 0),
  published boolean not null default false,
  players_listed integer not null default 0 check (players_listed >= 0),
  groups text[] not null default '{}'::text[],
  built_at timestamptz not null default now(),
  previous_built_at timestamptz
);

alter table public.community_rankings enable row level security;
alter table public.community_ranking_formats enable row level security;

drop policy if exists community_rankings_select_public on public.community_rankings;
create policy community_rankings_select_public on public.community_rankings
  for select to anon, authenticated
  using (true);

drop policy if exists community_rankings_service_role_all on public.community_rankings;
create policy community_rankings_service_role_all on public.community_rankings
  for all to service_role
  using (true)
  with check (true);

drop policy if exists community_ranking_formats_select_public on public.community_ranking_formats;
create policy community_ranking_formats_select_public on public.community_ranking_formats
  for select to anon, authenticated
  using (true);

drop policy if exists community_ranking_formats_service_role_all on public.community_ranking_formats;
create policy community_ranking_formats_service_role_all on public.community_ranking_formats
  for all to service_role
  using (true)
  with check (true);
