-- Migration 0370: the Long Shot history pool. Plan:
-- docs/completed/long-shot/long-shot-plan.md, section 31 (post-ship review 2).
--
-- Three tables fed by scripts/sync-nfl-history.ts from the nflverse data
-- releases (CC BY 4.0): season rosters 1920 to the present, the players
-- master file, the draft picks file (1980 to the present, with Hall of Fame,
-- Pro Bowl, All-Pro and career totals) and weekly player stats 1999 to the
-- present. Every row that comes straight from a source file keeps the source
-- row in `metadata`. The season stats table is an AGGREGATE of the weekly
-- file (sums, maxes and a positional PPR finish per season) and carries no
-- raw object: the weekly rows are a public, versioned release that can be
-- re-read in full at any time, and storing 460,000 wide rows for a game
-- that asks about season totals would cost more than it protects.
--
-- Access matrix (all three tables):
--   anon          : none
--   authenticated : none (the game's search route and the generator read
--                   them with the service role; nothing lists the pool)
--   service_role  : ALL
--   client writes : BLOCKED
--
-- long_shot_answers.player_id and long_shot_answer_tallies.player_id lose
-- their foreign keys to players: an answer may now be a history_players id
-- (a retired player no Sleeper id knows). Both stay uuid. The engine checks
-- that an id exists in one of the two tables before it records an answer.

create table if not exists public.history_players (
  id uuid primary key default gen_random_uuid(),
  natural_key text not null unique,
  full_name text not null,
  first_name text,
  last_name text,
  search_name text not null,
  birth_date date,
  position text,
  first_season integer not null,
  last_season integer not null,
  seasons_played integer not null default 0,
  franchise_keys text[] not null default '{}',
  gsis_id text,
  pfr_id text,
  sleeper_id text,
  player_id uuid references public.players(id) on delete set null,
  college text,
  draft_year integer,
  draft_round integer,
  draft_pick integer,
  draft_team text,
  hof boolean not null default false,
  pro_bowls integer not null default 0,
  all_pro integer not null default 0,
  career_games integer,
  career_pass_yd integer,
  career_pass_td integer,
  career_rush_yd integer,
  career_rush_td integer,
  career_rec integer,
  career_rec_yd integer,
  career_rec_td integer,
  prominence numeric(5,4) not null default 0 check (prominence >= 0 and prominence <= 1),
  headshot_url text,
  metadata jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists history_players_search_name on public.history_players (search_name);
create index if not exists history_players_gsis on public.history_players (gsis_id);
create index if not exists history_players_player on public.history_players (player_id);
create index if not exists history_players_position_first on public.history_players (position, first_season);
create index if not exists history_players_college on public.history_players (college);
create index if not exists history_players_draft on public.history_players (draft_year, draft_round);

create table if not exists public.history_player_seasons (
  id bigint generated always as identity primary key,
  history_player_id uuid not null references public.history_players(id) on delete cascade,
  season integer not null,
  team_code text not null,
  franchise_key text,
  position text,
  metadata jsonb,
  unique (history_player_id, season, team_code)
);

create index if not exists history_player_seasons_franchise on public.history_player_seasons (franchise_key, season);
create index if not exists history_player_seasons_player on public.history_player_seasons (history_player_id);

create table if not exists public.history_player_season_stats (
  history_player_id uuid not null references public.history_players(id) on delete cascade,
  season integer not null,
  position text,
  team_code text,
  games integer not null default 0,
  pass_yd integer not null default 0,
  pass_td integer not null default 0,
  rush_yd integer not null default 0,
  rush_td integer not null default 0,
  rec integer not null default 0,
  rec_yd integer not null default 0,
  rec_td integer not null default 0,
  ppr_points numeric(7,2) not null default 0,
  max_pass_yd integer not null default 0,
  max_pass_td integer not null default 0,
  max_rush_yd integer not null default 0,
  max_rush_td integer not null default 0,
  max_rec integer not null default 0,
  max_rec_yd integer not null default 0,
  max_rec_td integer not null default 0,
  ppr_finish integer,
  primary key (history_player_id, season)
);

create index if not exists history_player_season_stats_season on public.history_player_season_stats (season, position);

alter table public.history_players enable row level security;
alter table public.history_player_seasons enable row level security;
alter table public.history_player_season_stats enable row level security;

drop policy if exists history_players_service_role_all on public.history_players;
create policy history_players_service_role_all on public.history_players
  for all to service_role using (true) with check (true);
drop policy if exists history_player_seasons_service_role_all on public.history_player_seasons;
create policy history_player_seasons_service_role_all on public.history_player_seasons
  for all to service_role using (true) with check (true);
drop policy if exists history_player_season_stats_service_role_all on public.history_player_season_stats;
create policy history_player_season_stats_service_role_all on public.history_player_season_stats
  for all to service_role using (true) with check (true);

revoke all on public.history_players from anon, authenticated;
revoke all on public.history_player_seasons from anon, authenticated;
revoke all on public.history_player_season_stats from anon, authenticated;

comment on table public.history_players is
  'Every NFL player on a season roster since 1920, from the nflverse data releases (CC BY 4.0). Long Shot history pool; service role only.';
comment on column public.history_players.natural_key is
  'gsis:<id> when the source carries a league id, else name:<lower full name>|<birth date>. The sync upserts on it.';
comment on column public.history_players.prominence is
  'How well known the player is, 0 to 1, from seasons, honors, draft round and games. Stands in for the roster rate when tiering a historical answer.';
comment on column public.history_players.player_id is
  'The players row for the same person when one is known (Sleeper id or name plus birth date), else null.';
comment on table public.history_player_seasons is
  'One row per player, season and team from the nflverse season rosters. franchise_key is the modern franchise the team code belongs to, null for a defunct team.';
comment on table public.history_player_season_stats is
  'Per-season aggregate of the nflverse weekly player stats, 1999 on: totals, single-game maxes and the PPR positional finish.';

alter table public.long_shot_answers drop constraint if exists long_shot_answers_player_id_fkey;
alter table public.long_shot_answer_tallies drop constraint if exists long_shot_answer_tallies_player_id_fkey;

comment on column public.long_shot_answers.player_id is
  'A players.id or a history_players.id. No foreign key: the engine checks the id exists before writing it.';
comment on column public.long_shot_answer_tallies.player_id is
  'A players.id or a history_players.id, matching the prompt answer set. No foreign key.';
