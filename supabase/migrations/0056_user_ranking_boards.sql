-- Migration 0056: user_ranking_boards + user_ranking_board_players
--
-- Personal, user-authored ranking boards for the My Beacon dashboard. Each
-- signed-in user can build any number of boards: an "overall" board ranking
-- every eligible active fantasy player, and/or position-specific boards
-- (QB/RB/WR/TE/K/DEF). Tiers are optional per board.
--
-- These are USER-OWNED tables (one row set per user). They are deliberately
-- NOT the global, source-derived `rankings` table. The `user_` prefix plus the
-- ownership column (boards) / parent-board ownership (board players) make it
-- obvious that this is a user's own opinion data, not ingested source data.
-- Because the rankings are the user's manual ordering, they carry no source or
-- format dependency and need no metadata jsonb.
--
-- Access matrix:
--   user_ranking_boards
--     anon          : NONE
--     authenticated : SELECT/INSERT/UPDATE/DELETE OWN rows only (auth.uid() = user_id)
--     service_role  : ALL
--   user_ranking_board_players
--     anon          : NONE
--     authenticated : SELECT/INSERT/UPDATE/DELETE rows whose parent board is OWNED by the user
--     service_role  : ALL

create table if not exists public.user_ranking_boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  -- 'overall' ranks every eligible active player; a position value scopes the
  -- board to that single fantasy position. Mirrors lib/site.ts POSITIONS.
  scope text not null default 'overall'
    check (scope in ('overall', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF')),
  tiers_enabled boolean not null default false,
  -- Number of tier buckets available when tiers_enabled is true. Players
  -- reference a tier by integer 1..tier_count (or null for "no tier").
  tier_count integer not null default 3 check (tier_count between 0 and 30),
  -- Optional custom labels for tiers, keyed by tier number as text:
  -- {"1":"Elite","2":"Studs"}. Missing keys fall back to "Tier N" in the UI.
  tier_labels jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_ranking_boards_user
  on public.user_ranking_boards(user_id);

create table if not exists public.user_ranking_board_players (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.user_ranking_boards(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  -- 1-based order within the board (and within a tier when tiers are on).
  rank_position integer not null,
  -- Tier bucket (1..board.tier_count) or null for "no tier". Only meaningful
  -- when the parent board has tiers_enabled.
  tier integer check (tier is null or tier >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A given player appears at most once per board.
  unique (board_id, player_id)
);

-- Primary read path: load a board's players in display order.
create index if not exists idx_user_ranking_board_players_board
  on public.user_ranking_board_players(board_id, rank_position);
-- Supports the players FK cascade and reverse lookups.
create index if not exists idx_user_ranking_board_players_player
  on public.user_ranking_board_players(player_id);

alter table public.user_ranking_boards enable row level security;
alter table public.user_ranking_board_players enable row level security;

-- ---------------------------------------------------------------------------
-- user_ranking_boards: owner-only (auth.uid() = user_id)
-- ---------------------------------------------------------------------------
drop policy if exists user_ranking_boards_select_own on public.user_ranking_boards;
create policy user_ranking_boards_select_own on public.user_ranking_boards
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_ranking_boards_insert_own on public.user_ranking_boards;
create policy user_ranking_boards_insert_own on public.user_ranking_boards
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_ranking_boards_update_own on public.user_ranking_boards;
create policy user_ranking_boards_update_own on public.user_ranking_boards
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_ranking_boards_delete_own on public.user_ranking_boards;
create policy user_ranking_boards_delete_own on public.user_ranking_boards
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_ranking_boards_service_role_all on public.user_ranking_boards;
create policy user_ranking_boards_service_role_all on public.user_ranking_boards
  for all to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- user_ranking_board_players: ownership flows through the parent board.
-- Every policy confirms the referenced board belongs to the current user, so
-- a user can never read or mutate rows on someone else's board even if they
-- guess a board_id.
-- ---------------------------------------------------------------------------
drop policy if exists user_ranking_board_players_select_own on public.user_ranking_board_players;
create policy user_ranking_board_players_select_own on public.user_ranking_board_players
  for select to authenticated
  using (
    exists (
      select 1
      from public.user_ranking_boards b
      where b.id = board_id
        and b.user_id = auth.uid()
    )
  );

drop policy if exists user_ranking_board_players_insert_own on public.user_ranking_board_players;
create policy user_ranking_board_players_insert_own on public.user_ranking_board_players
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.user_ranking_boards b
      where b.id = board_id
        and b.user_id = auth.uid()
    )
  );

drop policy if exists user_ranking_board_players_update_own on public.user_ranking_board_players;
create policy user_ranking_board_players_update_own on public.user_ranking_board_players
  for update to authenticated
  using (
    exists (
      select 1
      from public.user_ranking_boards b
      where b.id = board_id
        and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.user_ranking_boards b
      where b.id = board_id
        and b.user_id = auth.uid()
    )
  );

drop policy if exists user_ranking_board_players_delete_own on public.user_ranking_board_players;
create policy user_ranking_board_players_delete_own on public.user_ranking_board_players
  for delete to authenticated
  using (
    exists (
      select 1
      from public.user_ranking_boards b
      where b.id = board_id
        and b.user_id = auth.uid()
    )
  );

drop policy if exists user_ranking_board_players_service_role_all on public.user_ranking_board_players;
create policy user_ranking_board_players_service_role_all on public.user_ranking_board_players
  for all to service_role
  using (true)
  with check (true);
