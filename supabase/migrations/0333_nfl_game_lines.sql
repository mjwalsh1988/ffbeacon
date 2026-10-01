-- 0333: nfl_game_lines. The settled betting line for one finished NFL game:
-- the closing spread, total and moneylines, with the opening numbers beside
-- them.
--
-- ACCESS MATRIX
--   anon           SELECT
--   authenticated  SELECT
--   service_role   ALL (the sync writes; nothing client-side ever does)
--
-- WHY A SECOND TABLE
--
-- nfl_game_odds (0238) is the LATEST line for an upcoming game. It is
-- overwritten in place by a daily sync, and ESPN's scoreboard stops carrying
-- odds once a game kicks off, so for weeks 2 and 3 of 2026 the daily refresh
-- replaced fifteen of sixteen lines with nulls after the games were played.
-- That table answers "what does the market expect", which is the projection
-- engine's question. The Beacon Brief asks a different one, "what did the
-- market expect, and what happened", and the answer to that must never change
-- after the game. So it lives here, written once per game from ESPN's
-- per-event odds document, which keeps the open and close numbers after the
-- final whistle.
--
-- SOURCE
--
-- sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{id}/
-- competitions/{id}/odds, public, no key. The event id is the `id` on the
-- competition object nfl_game_odds.metadata already stores. `provider` is the
-- book ESPN quoted (DraftKings today). `metadata` keeps the provider's odds
-- item verbatim, per the source-preservation rule.
--
-- SIGN CONVENTION
--
-- close_home_spread and open_home_spread follow nfl_game_odds.home_spread:
-- NEGATIVE means the home team is favoured. Moneylines are American odds.
--
-- TEAM CODES ARE OURS (WAS, not ESPN's WSH), exactly as in nfl_game_odds.

create table if not exists public.nfl_game_lines (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'espn',
  espn_event_id text not null,
  season integer not null,
  season_type text not null default 'regular',
  week integer not null,
  home_team text not null,
  away_team text not null,
  kickoff_at timestamptz,
  provider text,
  open_home_spread numeric,
  close_home_spread numeric,
  open_game_total numeric,
  close_game_total numeric,
  home_moneyline integer,
  away_moneyline integer,
  over_odds integer,
  under_odds integer,
  metadata jsonb,
  captured_at timestamptz not null default now(),
  constraint nfl_game_lines_season_check check (season between 1990 and 2100),
  constraint nfl_game_lines_week_check check (week between 1 and 25),
  constraint nfl_game_lines_season_type_check
    check (season_type in ('pre', 'regular', 'post')),
  constraint nfl_game_lines_teams_differ check (home_team <> away_team),
  constraint nfl_game_lines_event_id_check check (espn_event_id ~ '^[0-9]{1,20}$'),
  constraint nfl_game_lines_unique unique (source, espn_event_id)
);

create index if not exists nfl_game_lines_week_idx
  on public.nfl_game_lines (season, season_type, week);

alter table public.nfl_game_lines enable row level security;

-- Public read. A closing line is a published market figure.
drop policy if exists nfl_game_lines_select_public on public.nfl_game_lines;
create policy nfl_game_lines_select_public
  on public.nfl_game_lines
  for select
  to anon, authenticated
  using (true);

-- Writes are the sync only. There is no client-side write path.
drop policy if exists nfl_game_lines_service_role_all on public.nfl_game_lines;
create policy nfl_game_lines_service_role_all
  on public.nfl_game_lines
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.nfl_game_lines is
  'The settled line for a finished NFL game: closing and opening spread and total, and the closing moneylines. Written once per game by the odds cron after kickoff. Read by the Beacon Brief game cards.';

comment on column public.nfl_game_lines.close_home_spread is
  'Closing spread. Negative means the home team was favoured.';

comment on column public.nfl_game_lines.metadata is
  'The provider odds item from ESPN''s per-event odds document, verbatim.';
