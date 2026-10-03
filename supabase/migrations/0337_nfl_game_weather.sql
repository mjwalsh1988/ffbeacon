-- 0337: nfl_game_weather. Weather forecast snapshots for NFL games, one row
-- per game per fetch.
--
-- ACCESS MATRIX
--   anon           SELECT
--   authenticated  SELECT
--   service_role   ALL (the weather sync writes; nothing client-side ever does)
--
-- WHAT IT IS
--
-- Section 2.4 of docs/projection-engine/projection-engine-v2-plan.md, built
-- early for Season Pulse (docs/season-pulse/season-pulse-plan.md) as data and
-- display only. Nothing adjusts a projection from this table yet.
--
-- APPEND-ONLY. A forecast changes until kickoff, so each fetch is a new row
-- with the time it was fetched, and "the forecast" for a game is its newest
-- row. That keeps "what did we know on Tuesday" a query, and it is what a
-- later backtest needs to grade a Tuesday projection against Tuesday's
-- information.
--
-- THE FORECAST IS FOR KICKOFF AND THE THREE HOURS AFTER IT, because a game
-- lasts three hours and a front can arrive in the second half. temp_f,
-- feels_like_f, wind_mph, wind_dir_deg, humidity_pct and conditions describe
-- the kickoff hour; wind_gust_mph, wind_mph_max_3h, precip_prob_pct, precip_in
-- and snow_in describe the window.
--
-- AN INDOOR GAME IS A ROW TOO. is_indoor = true, every weather column null,
-- provider 'stadium-roof', written once per game with no provider call. The
-- row exists so a reader can tell "played indoors" from "no forecast yet".
--
-- A MISSING FORECAST IS NEVER CALM. No row inside the provider's horizon means
-- nothing is known, and every reader must say so rather than assume fair
-- weather.
--
-- game_key IS NOT A FOREIGN KEY YET. It is the nflverse game id
-- (2026_04_GB_TB: season, two-digit week, away, home, with nflverse's LA for
-- the Rams), which is what the planned nfl_games table is keyed on. That table
-- does not exist, so the row also carries season, week and both teams in our
-- own codes and a page can read it without a join.
--
-- PROVIDERS
--   nws           National Weather Service, api.weather.gov. US games.
--   met-norway    MET Norway Locationforecast. Games abroad. It publishes no
--                 gusts and no precipitation probability outside the Nordic
--                 region, so those two columns are null on its rows.
--   stadium-roof  no provider: the venue has a roof.
-- `metadata` keeps the provider's hourly slice verbatim, per the
-- source-preservation rule. It is null on a stadium-roof row.

create table if not exists public.nfl_game_weather (
  id uuid primary key default gen_random_uuid(),
  game_key text not null,
  season integer not null,
  season_type text not null default 'regular',
  week integer not null,
  home_team text not null,
  away_team text not null,
  kickoff_at timestamptz not null,
  stadium_id text references public.nfl_stadiums (id),
  provider text not null,
  fetched_at timestamptz not null default now(),
  lead_hours numeric not null,
  is_indoor boolean not null default false,
  temp_f numeric,
  feels_like_f numeric,
  wind_mph numeric,
  wind_gust_mph numeric,
  wind_dir_deg integer,
  wind_mph_max_3h numeric,
  precip_prob_pct integer,
  precip_in numeric,
  snow_in numeric,
  humidity_pct integer,
  conditions text,
  metadata jsonb,
  constraint nfl_game_weather_season_check check (season between 1990 and 2100),
  constraint nfl_game_weather_week_check check (week between 1 and 25),
  constraint nfl_game_weather_season_type_check
    check (season_type in ('pre', 'regular', 'post')),
  constraint nfl_game_weather_teams_differ check (home_team <> away_team),
  constraint nfl_game_weather_game_key_check
    check (game_key ~ '^[0-9]{4}_[0-9]{2}_[A-Z]{2,3}_[A-Z]{2,3}$'),
  constraint nfl_game_weather_provider_check
    check (provider in ('nws', 'met-norway', 'stadium-roof')),
  constraint nfl_game_weather_wind_dir_check
    check (wind_dir_deg is null or wind_dir_deg between 0 and 360),
  constraint nfl_game_weather_precip_prob_check
    check (precip_prob_pct is null or precip_prob_pct between 0 and 100),
  constraint nfl_game_weather_humidity_check
    check (humidity_pct is null or humidity_pct between 0 and 100),
  -- An indoor row carries no weather, so it can never be read as a forecast.
  constraint nfl_game_weather_indoor_is_blank check (
    not is_indoor
    or (
      temp_f is null and feels_like_f is null and wind_mph is null
      and wind_gust_mph is null and wind_dir_deg is null and wind_mph_max_3h is null
      and precip_prob_pct is null and precip_in is null and snow_in is null
      and humidity_pct is null and conditions is null
    )
  ),
  constraint nfl_game_weather_unique unique (game_key, provider, fetched_at)
);

create index if not exists nfl_game_weather_week_idx
  on public.nfl_game_weather (season, season_type, week);

create index if not exists nfl_game_weather_latest_idx
  on public.nfl_game_weather (game_key, fetched_at desc);

create index if not exists nfl_game_weather_stadium_idx
  on public.nfl_game_weather (stadium_id);

alter table public.nfl_game_weather enable row level security;

-- Public read. A weather forecast is published information.
drop policy if exists nfl_game_weather_select_public on public.nfl_game_weather;
create policy nfl_game_weather_select_public
  on public.nfl_game_weather
  for select
  to anon, authenticated
  using (true);

-- Writes are the weather sync only. There is no client-side write path.
drop policy if exists nfl_game_weather_service_role_all on public.nfl_game_weather;
create policy nfl_game_weather_service_role_all
  on public.nfl_game_weather
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.nfl_game_weather is
  'Append-only weather forecast snapshots for NFL games, one per game per fetch. The newest row for a game is its forecast. An indoor game has one row saying so. Read by the Season Pulse pages.';

comment on column public.nfl_game_weather.lead_hours is
  'Hours from the fetch to kickoff. A forecast six days out is a weaker statement than one six hours out.';

comment on column public.nfl_game_weather.wind_mph is
  'Sustained wind at kickoff, miles per hour.';

comment on column public.nfl_game_weather.wind_mph_max_3h is
  'The highest sustained wind across kickoff and the three hours after it.';

comment on column public.nfl_game_weather.metadata is
  'The provider''s hourly slice for the game window, verbatim. Null on an indoor row.';
