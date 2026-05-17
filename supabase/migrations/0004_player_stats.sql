-- Migration 0004: player_stats
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.player_stats (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,

  week integer not null,
  season integer not null,
  season_type text not null default 'regular' check (season_type in ('regular','post','pre')),

  sleeper_stats jsonb,

  pass_yd integer not null default 0,
  pass_td integer not null default 0,
  pass_int integer not null default 0,
  pass_2pt integer not null default 0,

  rush_yd integer not null default 0,
  rush_td integer not null default 0,
  rush_2pt integer not null default 0,

  rec integer not null default 0,
  rec_yd integer not null default 0,
  rec_td integer not null default 0,
  rec_2pt integer not null default 0,

  fum_lost integer not null default 0,

  pts_standard numeric not null default 0,
  pts_half_ppr numeric not null default 0,
  pts_ppr numeric not null default 0,

  snap_count integer,
  snap_pct numeric,
  targets integer,
  carries integer,
  air_yards numeric,
  target_share numeric,

  opponent text,
  game_id text,

  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(player_id, week, season, season_type)
);

create index if not exists idx_stats_player_season on public.player_stats(player_id, season);
create index if not exists idx_stats_week on public.player_stats(season, week);
create index if not exists idx_stats_season_type on public.player_stats(season, season_type);

alter table public.player_stats enable row level security;

drop policy if exists player_stats_select_public on public.player_stats;
create policy player_stats_select_public on public.player_stats
  for select to anon, authenticated using (true);

drop policy if exists player_stats_service_role_all on public.player_stats;
create policy player_stats_service_role_all on public.player_stats
  for all to service_role using (true) with check (true);
