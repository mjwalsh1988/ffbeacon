-- Migration 0162: league_matchups (Sleeper head-to-head schedule + results)
--
-- Power Pulse needs to know who each team plays every remaining week. Sleeper
-- publishes this at GET /league/{id}/matchups/{week}: one row per roster per
-- week, with `matchup_id` pairing the two rosters that face each other. The
-- full season schedule exists from league creation, so a preseason league
-- already exposes weeks 1-18.
--
-- One row per (league, week, roster). The opponent is derived at read time by
-- finding the sibling row with the same (week, matchup_id); storing it directly
-- would duplicate a fact Sleeper already encodes and could drift.
--
-- `points` is 0 for unplayed weeks. `is_final` marks a week whose result is
-- locked, which lets the Power Pulse engine treat played weeks as fact and
-- future weeks as projections without re-deriving the current NFL week.
--
-- Naming: `league_` prefix groups this with leagues / league_users / league_
-- transactions / league_drafts / league_power_* in the table browser.
--
-- Access matrix (public read-only ingested data pattern):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (pulseLeague writes)
--   client writes : BLOCKED

create table if not exists public.league_matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  season integer not null,
  week integer not null,
  sleeper_roster_id integer not null,
  -- Sleeper's pairing key. Both rosters in a head-to-head share this value.
  -- Null when a league has an odd roster out or Sleeper has not generated the
  -- pairing (rare, and treated as "no opponent this week" by the engine).
  matchup_id integer,
  points numeric not null default 0,
  -- The lineup Sleeper had set for that week at fetch time. Future weeks carry
  -- the manager's current lineup, which is exactly what "if the season started
  -- today" lineup efficiency needs.
  starter_ids jsonb not null default '[]'::jsonb,
  starter_points jsonb not null default '[]'::jsonb,
  player_ids jsonb not null default '[]'::jsonb,
  player_points jsonb not null default '{}'::jsonb,
  is_final boolean not null default false,
  metadata jsonb,
  synced_at timestamptz not null default now(),
  unique (league_id, week, sleeper_roster_id)
);

create index if not exists idx_league_matchups_league_week
  on public.league_matchups(league_id, week);

alter table public.league_matchups enable row level security;

drop policy if exists league_matchups_select_public on public.league_matchups;
create policy league_matchups_select_public on public.league_matchups
  for select to anon, authenticated using (true);

drop policy if exists league_matchups_service_role_all on public.league_matchups;
create policy league_matchups_service_role_all on public.league_matchups
  for all to service_role using (true) with check (true);
