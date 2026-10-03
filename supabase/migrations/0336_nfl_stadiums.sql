-- 0336: nfl_stadiums. Where each NFL game is played: coordinates, roof and
-- time zone for every venue on the schedule.
--
-- ACCESS MATRIX
--   anon           SELECT
--   authenticated  SELECT
--   service_role   ALL (the seed below, and the weather sync caching a
--                  forecast grid; nothing client-side ever writes)
--
-- WHY
--
-- A weather forecast needs a latitude and a longitude, and "should I worry
-- about the wind" needs to know whether there is a roof. Until this table no
-- part of the site knew either. nfl_game_odds.metadata carries ESPN's venue
-- name and an indoor flag, but no coordinates, and its indoor flag calls SoFi
-- Stadium outdoors and every retractable roof indoors.
--
-- This is section 2.1 of docs/projection-engine/projection-engine-v2-plan.md,
-- built early for Season Pulse (docs/season-pulse/season-pulse-plan.md). It is
-- a SEED, not a sync: 38 rows, the venues on the 2026 schedule.
--
-- COLUMNS THAT ARE OURS
--
-- `roof` is hand-set and is the venue's construction, not the state of the
-- roof on a given day:
--   outdoors     open air
--   dome         fixed roof (SoFi's canopy counts: it keeps wind and rain out)
--   retractable  can open; no feed says whether it will, so every reader
--                treats it as closed
--
-- `id` is the nflverse stadium_id where one exists, so a later nfl_games table
-- joins without a mapping. Buffalo's new stadium opened in 2026 and has no
-- nflverse id yet; it is BUF01 here.
--
-- `external_ids.espn` is the venue id on the schedule rows we already store
-- (nfl_game_odds.metadata.venue.id), which is how a game finds its stadium
-- until nfl_games exists.
--
-- The nws_* columns cache the National Weather Service forecast grid for a US
-- venue (one /points lookup, re-checked monthly). They describe an operation
-- against one provider, which is the case the naming rule allows a source name
-- in a column for.
--
-- SOURCES
--
-- Coordinates, elevation and field heading: the greerreNFL Stadiums dataset
-- (github.com/greerreNFL/Stadiums), read 2026-10-03. Buffalo's row there is the
-- OLD Highmark Stadium, about 200 metres from the new one; its coordinates are
-- used for BUF01 because a forecast grid cell is 2.5 km across, and the field
-- heading is left null because the new field's is not the old one's.

create table if not exists public.nfl_stadiums (
  id text primary key,
  name text not null,
  city text,
  region text,
  country text not null default 'US',
  latitude numeric not null,
  longitude numeric not null,
  elevation_m integer,
  roof text not null,
  field_heading_deg integer,
  time_zone text not null,
  home_teams text[] not null default '{}',
  active_from integer,
  active_to integer,
  external_ids jsonb not null default '{}'::jsonb,
  nws_office text,
  nws_grid_x integer,
  nws_grid_y integer,
  nws_grid_checked_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfl_stadiums_id_check check (id ~ '^[A-Z]{3}[0-9]{2}$'),
  constraint nfl_stadiums_roof_check check (roof in ('outdoors', 'dome', 'retractable')),
  constraint nfl_stadiums_latitude_check check (latitude between -90 and 90),
  constraint nfl_stadiums_longitude_check check (longitude between -180 and 180),
  constraint nfl_stadiums_heading_check
    check (field_heading_deg is null or field_heading_deg between 0 and 359),
  constraint nfl_stadiums_country_check check (country ~ '^[A-Z]{2}$')
);

create index if not exists nfl_stadiums_espn_venue_idx
  on public.nfl_stadiums ((external_ids ->> 'espn'));

alter table public.nfl_stadiums enable row level security;

-- Public read. Where a stadium is and whether it has a roof is public fact.
drop policy if exists nfl_stadiums_select_public on public.nfl_stadiums;
create policy nfl_stadiums_select_public
  on public.nfl_stadiums
  for select
  to anon, authenticated
  using (true);

-- Writes are the seed and the weather sync only.
drop policy if exists nfl_stadiums_service_role_all on public.nfl_stadiums;
create policy nfl_stadiums_service_role_all
  on public.nfl_stadiums
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.nfl_stadiums is
  'One row per venue an NFL game is played in: coordinates, roof class and time zone. A seed, read by the weather sync and the Season Pulse weather page.';

comment on column public.nfl_stadiums.roof is
  'The venue''s construction: outdoors, dome, or retractable. A retractable roof is treated as closed by every reader, because no feed says whether it will be open.';

comment on column public.nfl_stadiums.external_ids is
  'Venue ids in other systems, keyed by source. espn is the id on nfl_game_odds.metadata.venue.';

comment on column public.nfl_stadiums.metadata is
  'Provenance for the seeded row: which dataset the coordinates came from and anything about them worth knowing.';

insert into public.nfl_stadiums
  (id, name, city, region, country, latitude, longitude, elevation_m, roof, field_heading_deg, time_zone, home_teams, active_from, external_ids, metadata)
values
  ('ATL97', 'Mercedes-Benz Stadium', 'Atlanta', 'GA', 'US', 33.7555052, -84.4008484, 307, 'retractable', 80, 'America/New_York', '{ATL}', 2017, '{"espn":"5348"}', '{"coordinates":"greerreNFL/Stadiums ATL97"}'),
  ('BAL00', 'M&T Bank Stadium', 'Baltimore', 'MD', 'US', 39.277958, -76.6227221, 3, 'outdoors', 290, 'America/New_York', '{BAL}', 1998, '{"espn":"3814"}', '{"coordinates":"greerreNFL/Stadiums BAL00"}'),
  ('BOS00', 'Gillette Stadium', 'Foxborough', 'MA', 'US', 42.0909217, -71.2643321, 78, 'outdoors', 342, 'America/New_York', '{NE}', 2002, '{"espn":"3738"}', '{"coordinates":"greerreNFL/Stadiums BOS00"}'),
  ('BUF01', 'Highmark Stadium', 'Orchard Park', 'NY', 'US', 42.7737531, -78.786954, 218, 'outdoors', null, 'America/New_York', '{BUF}', 2026, '{"espn":"11938"}', '{"coordinates":"greerreNFL/Stadiums BUF00, the old stadium about 200 metres away","note":"Opened 2026. Open air under a partial canopy."}'),
  ('CAR00', 'Bank of America Stadium', 'Charlotte', 'NC', 'US', 35.2258152, -80.8528376, 221, 'outdoors', 320, 'America/New_York', '{CAR}', 1996, '{"espn":"3628"}', '{"coordinates":"greerreNFL/Stadiums CAR00"}'),
  ('CHI98', 'Soldier Field', 'Chicago', 'IL', 'US', 41.8624598, -87.6167762, 177, 'outdoors', 356, 'America/Chicago', '{CHI}', 1971, '{"espn":"3933"}', '{"coordinates":"greerreNFL/Stadiums CHI98"}'),
  ('CIN00', 'Paycor Stadium', 'Cincinnati', 'OH', 'US', 39.0954306, -84.5160435, 146, 'outdoors', 321, 'America/New_York', '{CIN}', 2000, '{"espn":"3874"}', '{"coordinates":"greerreNFL/Stadiums CIN00"}'),
  ('CLE00', 'Huntington Bank Field', 'Cleveland', 'OH', 'US', 41.5060371, -81.699586, 177, 'outdoors', 56, 'America/New_York', '{CLE}', 1999, '{"espn":"3679"}', '{"coordinates":"greerreNFL/Stadiums CLE00"}'),
  ('DAL00', 'AT&T Stadium', 'Arlington', 'TX', 'US', 32.7479723, -97.0928461, 243, 'retractable', 69, 'America/Chicago', '{DAL}', 2009, '{"espn":"3687"}', '{"coordinates":"greerreNFL/Stadiums DAL00"}'),
  ('DEN00', 'Empower Field at Mile High', 'Denver', 'CO', 'US', 39.7439402, -105.0201065, 1584, 'outdoors', 0, 'America/Denver', '{DEN}', 2001, '{"espn":"3937"}', '{"coordinates":"greerreNFL/Stadiums DEN00"}'),
  ('DET00', 'Ford Field', 'Detroit', 'MI', 'US', 42.3401334, -83.0456783, 184, 'dome', 334, 'America/Detroit', '{DET}', 2002, '{"espn":"3727"}', '{"coordinates":"greerreNFL/Stadiums DET00"}'),
  ('GNB00', 'Lambeau Field', 'Green Bay', 'WI', 'US', 44.5014769, -88.0621617, 189, 'outdoors', 359, 'America/Chicago', '{GB}', 1957, '{"espn":"3798"}', '{"coordinates":"greerreNFL/Stadiums GNB00"}'),
  ('HOU00', 'NRG Stadium', 'Houston', 'TX', 'US', 29.6849239, -95.41082, 15, 'retractable', 0, 'America/Chicago', '{HOU}', 2002, '{"espn":"3891"}', '{"coordinates":"greerreNFL/Stadiums HOU00"}'),
  ('IND00', 'Lucas Oil Stadium', 'Indianapolis', 'IN', 'US', 39.7602037, -86.1638068, 216, 'retractable', 26, 'America/Indiana/Indianapolis', '{IND}', 2008, '{"espn":"3812"}', '{"coordinates":"greerreNFL/Stadiums IND00"}'),
  ('JAX00', 'EverBank Stadium', 'Jacksonville', 'FL', 'US', 30.3239164, -81.6373486, 1, 'outdoors', 14, 'America/New_York', '{JAX}', 1995, '{"espn":"3712"}', '{"coordinates":"greerreNFL/Stadiums JAX00"}'),
  ('KAN00', 'GEHA Field at Arrowhead Stadium', 'Kansas City', 'MO', 'US', 39.0489275, -94.4839962, 257, 'outdoors', 316, 'America/Chicago', '{KC}', 1972, '{"espn":"3622"}', '{"coordinates":"greerreNFL/Stadiums KAN00"}'),
  ('LAX01', 'SoFi Stadium', 'Inglewood', 'CA', 'US', 33.953485, -118.3390307, 37, 'dome', 335, 'America/Los_Angeles', '{LAR,LAC}', 2020, '{"espn":"7065"}', '{"coordinates":"greerreNFL/Stadiums LAX01","note":"A fixed canopy with open sides. Classed as a dome because it keeps wind and rain off the field."}'),
  ('MIA00', 'Hard Rock Stadium', 'Miami Gardens', 'FL', 'US', 25.9579623, -80.2388423, 3, 'outdoors', 301, 'America/New_York', '{MIA}', 1987, '{"espn":"3948"}', '{"coordinates":"greerreNFL/Stadiums MIA00"}'),
  ('MIN01', 'U.S. Bank Stadium', 'Minneapolis', 'MN', 'US', 44.9736273, -93.2574111, 261, 'dome', 312, 'America/Chicago', '{MIN}', 2016, '{"espn":"5239"}', '{"coordinates":"greerreNFL/Stadiums MIN01"}'),
  ('NAS00', 'Nissan Stadium', 'Nashville', 'TN', 'US', 36.1664774, -86.7712938, 121, 'outdoors', 335, 'America/Chicago', '{TEN}', 1999, '{"espn":"3810"}', '{"coordinates":"greerreNFL/Stadiums NAS00"}'),
  ('NOR00', 'Caesars Superdome', 'New Orleans', 'LA', 'US', 29.9511425, -90.0810779, 1, 'dome', 292, 'America/Chicago', '{NO}', 1975, '{"espn":"3493"}', '{"coordinates":"greerreNFL/Stadiums NOR00"}'),
  ('NYC01', 'MetLife Stadium', 'East Rutherford', 'NJ', 'US', 40.8135075, -74.0743424, 2, 'outdoors', 346, 'America/New_York', '{NYG,NYJ}', 2010, '{"espn":"3839"}', '{"coordinates":"greerreNFL/Stadiums NYC01"}'),
  ('PHI00', 'Lincoln Financial Field', 'Philadelphia', 'PA', 'US', 39.9007914, -75.1674645, 3, 'outdoors', 352, 'America/New_York', '{PHI}', 2003, '{"espn":"3806"}', '{"coordinates":"greerreNFL/Stadiums PHI00"}'),
  ('PHO00', 'State Farm Stadium', 'Glendale', 'AZ', 'US', 33.5277555, -112.2625948, 326, 'retractable', 328, 'America/Phoenix', '{ARI}', 2006, '{"espn":"3970"}', '{"coordinates":"greerreNFL/Stadiums PHO00"}'),
  ('PIT00', 'Acrisure Stadium', 'Pittsburgh', 'PA', 'US', 40.4467883, -80.0157692, 221, 'outdoors', 335, 'America/New_York', '{PIT}', 2001, '{"espn":"3752"}', '{"coordinates":"greerreNFL/Stadiums PIT00"}'),
  ('SEA00', 'Lumen Field', 'Seattle', 'WA', 'US', 47.5951513, -122.3316259, 5, 'outdoors', 0, 'America/Los_Angeles', '{SEA}', 2002, '{"espn":"3673"}', '{"coordinates":"greerreNFL/Stadiums SEA00"}'),
  ('SFO01', 'Levi''s Stadium', 'Santa Clara', 'CA', 'US', 37.4031837, -121.9698094, 4, 'outdoors', 331, 'America/Los_Angeles', '{SF}', 2014, '{"espn":"4738"}', '{"coordinates":"greerreNFL/Stadiums SFO01"}'),
  ('TAM00', 'Raymond James Stadium', 'Tampa', 'FL', 'US', 27.9759691, -82.503356, 11, 'outdoors', 0, 'America/New_York', '{TB}', 1998, '{"espn":"3886"}', '{"coordinates":"greerreNFL/Stadiums TAM00"}'),
  ('VEG00', 'Allegiant Stadium', 'Las Vegas', 'NV', 'US', 36.0908515, -115.1833441, 665, 'dome', 25, 'America/Los_Angeles', '{LV}', 2020, '{"espn":"6501"}', '{"coordinates":"greerreNFL/Stadiums VEG00"}'),
  ('WAS00', 'Northwest Stadium', 'Landover', 'MD', 'US', 38.907703, -76.8645083, 60, 'outdoors', 299, 'America/New_York', '{WAS}', 1997, '{"espn":"3719"}', '{"coordinates":"greerreNFL/Stadiums WAS00"}'),
  ('LON00', 'Wembley Stadium', 'London', null, 'GB', 51.5559836, -0.2795903, 45, 'outdoors', 270, 'Europe/London', '{}', 2007, '{"espn":"2455"}', '{"coordinates":"greerreNFL/Stadiums LON00"}'),
  ('LON02', 'Tottenham Hotspur Stadium', 'London', null, 'GB', 51.6042151, -0.0662246, 13, 'outdoors', 356, 'Europe/London', '{}', 2019, '{"espn":"5534"}', '{"coordinates":"greerreNFL/Stadiums LON02"}'),
  ('MEX00', 'Estadio Banorte', 'Mexico City', null, 'MX', 19.3029718, -99.150481, 2237, 'outdoors', 6, 'America/Mexico_City', '{}', 2005, '{"espn":"8219"}', '{"coordinates":"greerreNFL/Stadiums MEX00"}'),
  ('MUN01', 'Allianz Arena', 'Munich', null, 'DE', 48.2188932, 11.6247241, 493, 'outdoors', 345, 'Europe/Berlin', '{}', 2022, '{"espn":"11930"}', '{"coordinates":"greerreNFL/Stadiums MUN01","note":"The stands are roofed and the pitch is open."}'),
  ('MEL00', 'Melbourne Cricket Ground', 'Melbourne', 'VIC', 'AU', -37.819943, 144.983447, 13, 'outdoors', null, 'Australia/Melbourne', '{}', 2026, '{"espn":"9119"}', '{"coordinates":"greerreNFL/Stadiums MEL00"}'),
  ('RIO00', 'Maracana Stadium', 'Rio de Janeiro', null, 'BR', -22.9122222, -43.2302778, 15, 'outdoors', null, 'America/Sao_Paulo', '{}', 2026, '{"espn":"11931"}', '{"coordinates":"greerreNFL/Stadiums RIO00","note":"The stands are roofed and the pitch is open."}'),
  ('PAR00', 'Stade de France', 'Saint-Denis', null, 'FR', 48.9244444, 2.36, 33, 'outdoors', null, 'Europe/Paris', '{}', 2026, '{"espn":"1781"}', '{"coordinates":"greerreNFL/Stadiums PAR00","note":"The stands are roofed and the pitch is open."}'),
  ('MAD01', 'Santiago Bernabeu Stadium', 'Madrid', null, 'ES', 40.45306, -3.68835, 714, 'retractable', null, 'Europe/Madrid', '{}', 2025, '{"espn":"1353"}', '{"coordinates":"greerreNFL/Stadiums MAD01"}')
on conflict (id) do nothing;
