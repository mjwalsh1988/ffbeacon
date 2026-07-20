-- Migration 0140: player_weekly_projections (Sleeper weekly point projections)
--
-- Replaces the unused, never-populated public.projections table (created in 0003
-- as AI start/sit scaffolding that was never wired to any importer) with a real
-- ingestion table for per-player, per-week projected fantasy points.
--
-- Data origin: Sleeper's per-week projections endpoint
--   https://api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular
-- One row per (source, season_type, season, week, sleeper_player_id). The nightly
-- sync OVERWRITES each row (upsert on the unique key), so the table always holds
-- the latest projection for every upcoming week, not a per-night history.
--
-- Projected points depend on scoring rules only (PPR vs Half vs Standard), never
-- on superflex or dynasty-vs-redraft, so the three scoring flavors live in three
-- columns (mirroring player_market_snapshots) instead of being duplicated across
-- every format_config row.
--
-- Access matrix (public read-only data pattern):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (nightly sync writes)
--   client writes : BLOCKED

-- 1. Drop the unused legacy projections table (0 rows, no inbound FKs, no views).
drop table if exists public.projections;

-- 2. New weekly projections ingestion table.
create table if not exists public.player_weekly_projections (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'sleeper',
  season integer not null,
  season_type text not null default 'regular',
  week integer not null,
  sleeper_player_id text not null,
  player_id uuid references public.players(id) on delete cascade,
  projected_pts_ppr numeric,
  projected_pts_half_ppr numeric,
  projected_pts_std numeric,
  opponent text,
  team text,
  game_id text,
  stat_line jsonb,
  metadata jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, season_type, season, week, sleeper_player_id)
);

create index if not exists idx_player_weekly_projections_season_week
  on public.player_weekly_projections(season, week);
create index if not exists idx_player_weekly_projections_player
  on public.player_weekly_projections(player_id);

-- 3. RLS: public reads, service-role writes only.
alter table public.player_weekly_projections enable row level security;

drop policy if exists player_weekly_projections_select_public on public.player_weekly_projections;
create policy player_weekly_projections_select_public on public.player_weekly_projections
  for select to anon, authenticated using (true);

drop policy if exists player_weekly_projections_service_role_all on public.player_weekly_projections;
create policy player_weekly_projections_service_role_all on public.player_weekly_projections
  for all to service_role using (true) with check (true);
