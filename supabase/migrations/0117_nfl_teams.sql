-- Migration 0117: nfl_teams (NFL teams dimension with brand colors and fan chants)
--
-- A public dimension table holding each NFL team's abbreviation, full name, the
-- three primary brand colors (hex), and the team's signature fan chant / cheer.
-- The abbreviation column matches the Sleeper-sourced players.team values (same
-- convention as the existing public.teams table) so any future joins line up.
-- Colors are the official team hex values. Chants use the recognized crowd
-- chant where one exists; teams without a distinctive chant fall back to
-- "Go <Name>!". Like players/rankings, it is public-readable; writes are
-- service-role only.
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.nfl_teams (
  id uuid primary key default gen_random_uuid(),
  abbreviation text unique not null,
  name text not null,
  primary_color text not null check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  tertiary_color text not null check (tertiary_color ~ '^#[0-9A-Fa-f]{6}$'),
  chant text not null,
  created_at timestamptz not null default now()
);

alter table public.nfl_teams enable row level security;

drop policy if exists nfl_teams_select_public on public.nfl_teams;
create policy nfl_teams_select_public on public.nfl_teams
  for select to anon, authenticated using (true);

drop policy if exists nfl_teams_service_role_all on public.nfl_teams;
create policy nfl_teams_service_role_all on public.nfl_teams
  for all to service_role using (true) with check (true);

comment on table public.nfl_teams is
  'NFL teams dimension with brand colors and fan chants. abbreviation matches Sleeper-sourced players.team. Public SELECT, service_role writes.';

insert into public.nfl_teams
  (abbreviation, name, primary_color, secondary_color, tertiary_color, chant) values
  ('BUF', 'Buffalo Bills',        '#00338D', '#C60C30', '#FFFFFF', 'Let''s Go Buffalo'),
  ('MIA', 'Miami Dolphins',       '#008E97', '#FC4C02', '#005778', 'Fins Up'),
  ('NE',  'New England Patriots',  '#002244', '#C60C30', '#B0B7BC', 'Go Patriots!'),
  ('NYJ', 'New York Jets',         '#125740', '#FFFFFF', '#000000', 'J-E-T-S JETS JETS JETS'),
  ('BAL', 'Baltimore Ravens',      '#241773', '#000000', '#9E7C0C', 'O!'),
  ('CIN', 'Cincinnati Bengals',    '#FB4F14', '#000000', '#FFFFFF', 'Who Dey'),
  ('CLE', 'Cleveland Browns',      '#311D00', '#FF3C00', '#FFFFFF', 'Here We Go Brownies'),
  ('PIT', 'Pittsburgh Steelers',   '#101820', '#FFB612', '#C60C30', 'Here We Go Steelers'),
  ('HOU', 'Houston Texans',        '#03202F', '#A71930', '#FFFFFF', 'Bulls on Parade'),
  ('IND', 'Indianapolis Colts',    '#002C5F', '#FFFFFF', '#A2AAAD', 'Go Colts!'),
  ('JAX', 'Jacksonville Jaguars',  '#006778', '#101820', '#D7A22A', 'DUUUVAL'),
  ('TEN', 'Tennessee Titans',      '#0C2340', '#4B92DB', '#C8102E', 'Titan Up'),
  ('DEN', 'Denver Broncos',        '#FB4F14', '#002244', '#FFFFFF', 'IN-COM-PLETE'),
  ('KC',  'Kansas City Chiefs',    '#E31837', '#FFB81C', '#FFFFFF', 'Go Chiefs!'),
  ('LV',  'Las Vegas Raiders',     '#000000', '#A5ACAF', '#FFFFFF', 'RAIDERS'),
  ('LAC', 'Los Angeles Chargers',  '#0080C6', '#FFC20E', '#002A5E', 'Bolt Up'),
  ('DAL', 'Dallas Cowboys',        '#003594', '#869397', '#041E42', 'How ''Bout Them Cowboys'),
  ('NYG', 'New York Giants',       '#0B2265', '#A71930', '#A5ACAF', 'Let''s Go Big Blue'),
  ('PHI', 'Philadelphia Eagles',   '#004C54', '#A5ACAF', '#000000', 'E-A-G-L-E-S EAGLES'),
  ('WAS', 'Washington Commanders', '#5A1414', '#FFB612', '#FFFFFF', 'Hail to the Commanders'),
  ('CHI', 'Chicago Bears',         '#0B162A', '#C83803', '#FFFFFF', 'Bear Down'),
  ('DET', 'Detroit Lions',         '#0076B6', '#B0B7BC', '#000000', 'One Pride'),
  ('GB',  'Green Bay Packers',     '#203731', '#FFB612', '#FFFFFF', 'GO PACK GO'),
  ('MIN', 'Minnesota Vikings',     '#4F2683', '#FFC62F', '#FFFFFF', 'SKOL'),
  ('ATL', 'Atlanta Falcons',       '#A71930', '#000000', '#A5ACAF', 'Rise Up'),
  ('CAR', 'Carolina Panthers',     '#0085CA', '#101820', '#BFC0BF', 'Keep Pounding'),
  ('NO',  'New Orleans Saints',    '#D3BC8D', '#101820', '#FFFFFF', 'Who Dat'),
  ('TB',  'Tampa Bay Buccaneers',  '#D50A0A', '#34302B', '#FF7900', 'Fire the Cannons'),
  ('ARI', 'Arizona Cardinals',     '#97233F', '#000000', '#FFB612', 'Go Cardinals!'),
  ('LAR', 'Los Angeles Rams',      '#003594', '#FFA300', '#FFFFFF', 'Rams House'),
  ('SF',  'San Francisco 49ers',   '#AA0000', '#B3995D', '#000000', 'Bang Bang Niner Gang'),
  ('SEA', 'Seattle Seahawks',      '#002244', '#69BE28', '#A5ACAF', 'SEA HAWKS')
on conflict (abbreviation) do nothing;
