-- 0238: nfl_game_odds. Game total, spread, and the implied team totals derived
-- from them, one row per scheduled game.
--
-- ACCESS MATRIX
--   anon           SELECT
--   authenticated  SELECT
--   service_role   ALL (the sync writes; nothing client-side ever does)
--
-- WHY THIS TABLE EXISTS
--
-- Sleeper's weekly projection contains no game environment at all. Measured on
-- the live 2026 board on 2026-09-01, Amon-Ra St. Brown projects between 19.43
-- and 20.01 across seven different opponents, with projected targets identical
-- to the hundredth in five of those weeks. That is a per-game season average
-- repeated eighteen times. It cannot know that a team is a fourteen point
-- underdog in a game with a 52 point total, and those two facts move fantasy
-- scoring more than almost anything else we currently model.
--
-- The implied team total is the standard way the industry carries that
-- information, and it is one subtraction away from the two numbers a book
-- publishes:
--
--   home_implied_total = game_total / 2 - home_spread / 2
--   away_implied_total = game_total / 2 + home_spread / 2
--
-- Both are stored rather than derived on read, because a null game_total and a
-- null home_spread must produce a null implied total rather than a confident
-- half of nothing.
--
-- SOURCE
--
-- ESPN's public scoreboard endpoint, which returns `spread` and `overUnder` per
-- competition with no authentication and no key. `source` is a column rather
-- than an assumption so a second provider can land beside this one without a
-- migration. `provider` records which book ESPN happened to quote, because
-- "DraftKings had it at 44.5" is a different claim from "the market had it at
-- 44.5" and the difference belongs in the audit trail.
--
-- `metadata` preserves the original ESPN competition object verbatim, per the
-- project's original-source-preservation rule. We store the whole thing even
-- though we currently read three fields out of it.
--
-- HOME TEAM IS THE KEY
--
-- Uniqueness is (source, season, season_type, week, home_team). A team plays at
-- most one home game a week, so this is exact, and it is stable across the
-- neutral-site games where ESPN still designates a home side. Keying on a game
-- id would tie us to one provider's identifier scheme.
--
-- TEAM CODES ARE OURS, NOT ESPN'S
--
-- Verified 2026-09-01: ESPN's 32 abbreviations match nfl_teams exactly except
-- for Washington, which ESPN calls WSH and we call WAS. The sync maps it. Rows
-- in this table always carry OUR code, so a join against nfl_teams, player_stats
-- or player_weekly_projections.opponent needs no translation.

create table if not exists public.nfl_game_odds (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'espn',
  season integer not null,
  season_type text not null default 'regular',
  week integer not null,
  home_team text not null,
  away_team text not null,
  kickoff_at timestamptz,
  game_total numeric,
  home_spread numeric,
  home_implied_total numeric,
  away_implied_total numeric,
  provider text,
  metadata jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfl_game_odds_season_check check (season between 1990 and 2100),
  constraint nfl_game_odds_week_check check (week between 1 and 25),
  constraint nfl_game_odds_season_type_check
    check (season_type in ('pre', 'regular', 'post')),
  constraint nfl_game_odds_teams_differ check (home_team <> away_team),
  constraint nfl_game_odds_unique
    unique (source, season, season_type, week, home_team)
);

create index if not exists nfl_game_odds_week_idx
  on public.nfl_game_odds (season, season_type, week);

create index if not exists nfl_game_odds_away_team_idx
  on public.nfl_game_odds (season, season_type, week, away_team);

alter table public.nfl_game_odds enable row level security;

-- Public read. Every value here is a published betting line, which was public
-- the moment the book posted it.
create policy nfl_game_odds_select_public
  on public.nfl_game_odds
  for select
  to anon, authenticated
  using (true);

-- Writes are the nightly sync only. There is no client-side write path and
-- there must never be one.
create policy nfl_game_odds_service_role_all
  on public.nfl_game_odds
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.nfl_game_odds is
  'Published game total and spread per scheduled NFL game, with the implied team totals derived from them. Read by the projection engine as game environment. Written by the sync only.';

comment on column public.nfl_game_odds.home_spread is
  'Negative means the home team is favoured, matching how a book quotes it.';

comment on column public.nfl_game_odds.home_implied_total is
  'game_total / 2 - home_spread / 2. Null when either input is null; never a confident half of nothing.';

comment on column public.nfl_game_odds.provider is
  'The book ESPN quoted for this line. Part of the audit trail, not a filter.';

comment on column public.nfl_game_odds.metadata is
  'The original ESPN competition object, verbatim, per the source-preservation rule.';
