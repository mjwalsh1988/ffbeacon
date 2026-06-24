-- Migration 0084: teams (NFL teams dimension; used by The Beacon Brief tagging)
--
-- No teams table existed before. This is a small public dimension table so the
-- Beacon Brief can tag articles with teams and mention team Discord roles. The
-- abbreviation column matches the Sleeper-sourced players.team values so team
-- resolution and any future joins line up. Like players/rankings, it is
-- public-readable; writes are service-role only.
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  abbreviation text unique not null,
  name text not null,
  conference text not null check (conference in ('AFC', 'NFC')),
  division text not null check (division in ('East', 'North', 'South', 'West')),
  -- Discord role ids to mention when an article is tagged with this team.
  discord_role_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_teams_conf_div
  on public.teams (conference, division);

alter table public.teams enable row level security;

drop policy if exists teams_select_public on public.teams;
create policy teams_select_public on public.teams
  for select to anon, authenticated using (true);

drop policy if exists teams_service_role_all on public.teams;
create policy teams_service_role_all on public.teams
  for all to service_role using (true) with check (true);

comment on table public.teams is
  'NFL teams dimension. abbreviation matches Sleeper-sourced players.team. discord_role_ids drives team-based Discord pings. Public SELECT, service_role writes.';

insert into public.teams (abbreviation, name, conference, division) values
  ('BUF', 'Buffalo Bills', 'AFC', 'East'),
  ('MIA', 'Miami Dolphins', 'AFC', 'East'),
  ('NE', 'New England Patriots', 'AFC', 'East'),
  ('NYJ', 'New York Jets', 'AFC', 'East'),
  ('BAL', 'Baltimore Ravens', 'AFC', 'North'),
  ('CIN', 'Cincinnati Bengals', 'AFC', 'North'),
  ('CLE', 'Cleveland Browns', 'AFC', 'North'),
  ('PIT', 'Pittsburgh Steelers', 'AFC', 'North'),
  ('HOU', 'Houston Texans', 'AFC', 'South'),
  ('IND', 'Indianapolis Colts', 'AFC', 'South'),
  ('JAX', 'Jacksonville Jaguars', 'AFC', 'South'),
  ('TEN', 'Tennessee Titans', 'AFC', 'South'),
  ('DEN', 'Denver Broncos', 'AFC', 'West'),
  ('KC', 'Kansas City Chiefs', 'AFC', 'West'),
  ('LV', 'Las Vegas Raiders', 'AFC', 'West'),
  ('LAC', 'Los Angeles Chargers', 'AFC', 'West'),
  ('DAL', 'Dallas Cowboys', 'NFC', 'East'),
  ('NYG', 'New York Giants', 'NFC', 'East'),
  ('PHI', 'Philadelphia Eagles', 'NFC', 'East'),
  ('WAS', 'Washington Commanders', 'NFC', 'East'),
  ('CHI', 'Chicago Bears', 'NFC', 'North'),
  ('DET', 'Detroit Lions', 'NFC', 'North'),
  ('GB', 'Green Bay Packers', 'NFC', 'North'),
  ('MIN', 'Minnesota Vikings', 'NFC', 'North'),
  ('ATL', 'Atlanta Falcons', 'NFC', 'South'),
  ('CAR', 'Carolina Panthers', 'NFC', 'South'),
  ('NO', 'New Orleans Saints', 'NFC', 'South'),
  ('TB', 'Tampa Bay Buccaneers', 'NFC', 'South'),
  ('ARI', 'Arizona Cardinals', 'NFC', 'West'),
  ('LAR', 'Los Angeles Rams', 'NFC', 'West'),
  ('SF', 'San Francisco 49ers', 'NFC', 'West'),
  ('SEA', 'Seattle Seahawks', 'NFC', 'West')
on conflict (abbreviation) do nothing;
