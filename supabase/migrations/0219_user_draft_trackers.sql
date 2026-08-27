-- Migration 0219: user_draft_trackers + user_draft_tracker_picks
--
-- The Draft Tracker: a manual draft board for drafts FF Beacon cannot see. An
-- in-person draft around a kitchen table, or a draft on a platform we do not
-- sync with. The user picks a player order (our value, Sleeper ADP, or A to Z),
-- picks the format the draft is being run under, and then crosses players off
-- as they go: one button takes a player for their own team, another marks a
-- player gone to somebody else.
--
-- These are USER-OWNED tables, one row set per account, following the same
-- shape and the same ownership rules as user_ranking_boards (migration 0056).
-- Nothing here is ingested from an outside source, so neither table carries a
-- metadata jsonb: the rows are the user's own record of a draft they attended.
--
-- WHY THE FORMAT LIVES ON THE TRACKER. A draft is run under one set of rules,
-- decided before the first pick and true for the whole night. The global format
-- toggle in the header answers a different question ("what do I usually look
-- at"), and letting it move a live draft's board mid-draft would reorder the
-- list under the user's hand. Format is therefore chosen once, at setup, and
-- stored here. Source stays user-controlled through the header, exactly as it
-- is everywhere else, because it changes whose value opinion is shown and not
-- which players are draftable.
--
-- WHY THERE IS NO pick_number COLUMN. Pick order is read off created_at, so an
-- undo in the middle of a draft renumbers the picks after it for free. A stored
-- number would have to be rewritten across every later row, and a concurrent
-- double-click could collide on it.
--
-- Access matrix:
--   user_draft_trackers
--     anon          : NONE
--     authenticated : SELECT/INSERT/UPDATE/DELETE OWN rows only (auth.uid() = user_id)
--     service_role  : ALL
--   user_draft_tracker_picks
--     anon          : NONE
--     authenticated : SELECT/INSERT/UPDATE/DELETE rows whose parent tracker is OWNED by the user
--     service_role  : ALL

create table if not exists public.user_draft_trackers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  -- The rules the draft is being run under. Drives which ranking rows the board
  -- reads and which Sleeper ADP market it is graded against.
  format_config_id uuid not null references public.format_configs(id),
  -- How the board is ordered. 'value' is player value from the user's chosen
  -- source, 'adp' is the Sleeper market for this format, 'alphabetical' is A to Z.
  order_by text not null default 'value'
    check (order_by in ('value', 'adp', 'alphabetical')),
  -- 'mine' tracks only the user's own roster: everyone else's picks simply come
  -- off the board. 'all' tracks every roster in the room.
  tracking_mode text not null default 'mine'
    check (tracking_mode in ('mine', 'all')),
  -- Teams in the room. Always 1 in 'mine' mode (the user's own).
  team_count integer not null default 1 check (team_count between 1 and 32),
  -- Which 0-based slot belongs to the user. Always 0 in 'mine' mode.
  my_team_slot integer not null default 0 check (my_team_slot >= 0),
  -- Optional labels, index = slot: ["Mike","Sarah"]. A missing or blank entry
  -- reads as "Team N" in the UI, so naming teams is never required.
  team_names jsonb not null default '[]'::jsonb
    check (jsonb_typeof(team_names) = 'array'),
  status text not null default 'active' check (status in ('active', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The user's own slot has to be one of the slots that exist.
  constraint user_draft_trackers_my_slot_in_range check (my_team_slot < team_count)
);

create index if not exists idx_user_draft_trackers_user
  on public.user_draft_trackers(user_id, created_at desc);

create table if not exists public.user_draft_tracker_picks (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.user_draft_trackers(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  -- The 0-based team slot that took the player. NULL means "off the board,
  -- owner not tracked", which is every other manager's pick in 'mine' mode.
  team_slot integer check (team_slot is null or team_slot >= 0),
  created_at timestamptz not null default now(),
  -- A player can be drafted once per draft.
  unique (tracker_id, player_id)
);

-- Primary read path: a tracker's picks in the order they were made.
create index if not exists idx_user_draft_tracker_picks_tracker
  on public.user_draft_tracker_picks(tracker_id, created_at);
-- Supports the players FK cascade.
create index if not exists idx_user_draft_tracker_picks_player
  on public.user_draft_tracker_picks(player_id);

alter table public.user_draft_trackers enable row level security;
alter table public.user_draft_tracker_picks enable row level security;

-- ---------------------------------------------------------------------------
-- user_draft_trackers: owner-only (auth.uid() = user_id)
-- ---------------------------------------------------------------------------
drop policy if exists user_draft_trackers_select_own on public.user_draft_trackers;
create policy user_draft_trackers_select_own on public.user_draft_trackers
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_draft_trackers_insert_own on public.user_draft_trackers;
create policy user_draft_trackers_insert_own on public.user_draft_trackers
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_draft_trackers_update_own on public.user_draft_trackers;
create policy user_draft_trackers_update_own on public.user_draft_trackers
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_draft_trackers_delete_own on public.user_draft_trackers;
create policy user_draft_trackers_delete_own on public.user_draft_trackers
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_draft_trackers_service_role_all on public.user_draft_trackers;
create policy user_draft_trackers_service_role_all on public.user_draft_trackers
  for all to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- user_draft_tracker_picks: ownership flows through the parent tracker, so a
-- guessed tracker_id reads and writes nothing.
-- ---------------------------------------------------------------------------
drop policy if exists user_draft_tracker_picks_select_own on public.user_draft_tracker_picks;
create policy user_draft_tracker_picks_select_own on public.user_draft_tracker_picks
  for select to authenticated
  using (
    exists (
      select 1
      from public.user_draft_trackers t
      where t.id = tracker_id
        and t.user_id = auth.uid()
    )
  );

drop policy if exists user_draft_tracker_picks_insert_own on public.user_draft_tracker_picks;
create policy user_draft_tracker_picks_insert_own on public.user_draft_tracker_picks
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.user_draft_trackers t
      where t.id = tracker_id
        and t.user_id = auth.uid()
    )
  );

drop policy if exists user_draft_tracker_picks_update_own on public.user_draft_tracker_picks;
create policy user_draft_tracker_picks_update_own on public.user_draft_tracker_picks
  for update to authenticated
  using (
    exists (
      select 1
      from public.user_draft_trackers t
      where t.id = tracker_id
        and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.user_draft_trackers t
      where t.id = tracker_id
        and t.user_id = auth.uid()
    )
  );

drop policy if exists user_draft_tracker_picks_delete_own on public.user_draft_tracker_picks;
create policy user_draft_tracker_picks_delete_own on public.user_draft_tracker_picks
  for delete to authenticated
  using (
    exists (
      select 1
      from public.user_draft_trackers t
      where t.id = tracker_id
        and t.user_id = auth.uid()
    )
  );

drop policy if exists user_draft_tracker_picks_service_role_all on public.user_draft_tracker_picks;
create policy user_draft_tracker_picks_service_role_all on public.user_draft_tracker_picks
  for all to service_role
  using (true)
  with check (true);
