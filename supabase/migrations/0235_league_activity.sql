-- Migration 0235: League Activity (the league's own record of what happened)
--
-- ONE TABLE, ONE ORDERING, ONE CURSOR. The overview panel and the full activity
-- page render a single stream mixing trades, waiver runs, lineup edits, matchup
-- results, settings changes and managers coming and going. Deriving that stream
-- on read from five different tables would mean five cursors and no stable sort,
-- so every event becomes a row here instead.
--
-- WHAT A ROW HOLDS IS FACTS, NOT PROSE. `payload` carries player ids, roster
-- ids, scores, and before/after values. The sentence a reader sees is written at
-- render time from those facts (lib/league-activity/writeup.ts). Storing the
-- finished sentence would freeze every old entry in whatever wording shipped
-- that week, and would make the copy unfixable after the fact.
--
-- WHERE THE ROWS COME FROM, AND WHY THAT DIFFERS BY KIND
--
--   ALREADY RECORDED. Transactions carry Sleeper's own `created_at_sleeper`,
--   and finished matchups carry settled scores. Both are projected out of
--   tables we already keep, so a league gets its full back history the first
--   time this runs.
--
--   ONLY THE CURRENT STATE IS KEPT. Lineups, scoring, roster slots, team count,
--   owners, commissioners: every sync upserts over the previous values and
--   nobody read them first. These are detected by reading the stored row BEFORE
--   the upsert overwrites it and diffing against what Sleeper just returned.
--   That is why `occurred_at_precision` exists: we watched the change happen
--   somewhere inside a sync window, and we do not know the minute. A card built
--   on an 'observed' row says so rather than printing a time we invented.
--
-- THE FIRST SIGHT RULE. The first time a league is ever synced there is no
-- prior row to diff, so no state-change events are written. We did not watch
-- anybody edit a lineup, we just met the league. Emitting there would fabricate
-- a history.
--
-- DEDUPE_KEY IS THE GUARANTEE, and it is claimed by the insert rather than
-- checked before it, the same way league_relay_posts works. A retried sync, a
-- forced refresh, and two concurrent page renders of the same cold league all
-- produce one row. Every key is prefixed with the league id so two leagues can
-- never collide.
--
-- Access matrix:
--   league_activity
--     anon          : SELECT
--     authenticated : SELECT
--     service_role  : ALL
--       Public SELECT is deliberate and is the one place this differs from
--       league_relay_posts. Every fact in a row is already visible on the
--       league pages that anyone with the league id can open: the transactions
--       feed, the schedule board, the rosters. The relay ledger is admin-only
--       because it stores RENDERED text about private leagues; this table
--       stores none. Anything added to `payload` later must clear the same bar.

create table if not exists public.league_activity (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,

  -- What happened. Narrow on purpose: a kind maps to exactly one card layout.
  kind text not null check (kind in (
    -- transactions, projected from league_transactions
    'trade',
    'waiver',
    'free_agent',
    'commissioner_move',
    -- results, projected from league_matchups
    'matchup_result',
    -- lineups, detected by diffing rosters
    'lineup_change',
    'reserve_move',
    -- league configuration, detected by diffing leagues
    'scoring_change',
    'roster_positions_change',
    'team_count_change',
    'league_setting_change',
    'league_renamed',
    'league_status_change',
    'draft_status_change',
    -- people, detected by diffing league_users and rosters.owner_user_id
    'manager_joined',
    'manager_left',
    'roster_owner_change',
    'commissioner_change',
    'team_identity_change'
  )),

  -- The filter bucket. Denormalised from `kind` so the feed's chips are one
  -- indexed equality rather than a nineteen-value IN list.
  category text not null check (category in (
    'transaction', 'result', 'lineup', 'settings', 'people'
  )),

  dedupe_key text not null,

  -- When it happened, and how well we know that.
  occurred_at timestamptz not null,
  occurred_at_precision text not null default 'observed'
    check (occurred_at_precision in ('exact', 'observed')),
  -- For an 'observed' row, the start of the window it was spotted in: the
  -- previous sync. Null on an 'exact' row, which needs no window.
  observed_from timestamptz,

  season integer,
  week integer,

  -- Which teams this concerns. Drives the "just my team" filter, so it is an
  -- array rather than a single id: a trade and a matchup both involve two.
  roster_ids integer[] not null default '{}',
  -- Every player named in the event, for a future "everything about this
  -- player" view. Not read by the feed today.
  player_ids text[] not null default '{}',

  payload jsonb not null default '{}'::jsonb,

  -- When we noticed. Equals occurred_at on an exact row; on an observed row it
  -- is the end of the window and occurred_at is set to it.
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (dedupe_key)
);

alter table public.league_activity enable row level security;

drop policy if exists league_activity_select_public on public.league_activity;
create policy league_activity_select_public
  on public.league_activity
  for select to anon, authenticated
  using (true);

drop policy if exists league_activity_service_role_all on public.league_activity;
create policy league_activity_service_role_all
  on public.league_activity
  for all to service_role
  using (true)
  with check (true);

-- The feed: one league, newest first. Every read starts here.
create index if not exists idx_league_activity_feed
  on public.league_activity(league_id, occurred_at desc);

-- The same read with a category chip active.
create index if not exists idx_league_activity_category
  on public.league_activity(league_id, category, occurred_at desc);

-- "Only my team". Array containment needs GIN.
create index if not exists idx_league_activity_rosters
  on public.league_activity using gin(roster_ids);

-- The projector's gate: the newest transaction and the furthest matchup week
-- already recorded, so a resync scans a bounded window instead of the season.
create index if not exists idx_league_activity_kind_recent
  on public.league_activity(league_id, kind, occurred_at desc);

comment on table public.league_activity is
  'One row per detected league event. Facts only; the card copy is written at render time. See migration 0235.';
