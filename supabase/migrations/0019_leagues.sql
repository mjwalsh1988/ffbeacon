-- Migration 0019: leagues
--
-- League Sync feature: persists synced Sleeper league metadata.
-- One row per (sleeper_league_id). Sleeper league IDs are not
-- secret (they appear in Sleeper share URLs), so reads are public.
-- All writes flow through the service-role sync script.
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  sleeper_league_id text not null unique,
  name text not null,
  season integer not null,
  sport text not null default 'nfl',
  status text,
  total_rosters integer,
  scoring_settings jsonb not null default '{}'::jsonb,
  roster_positions jsonb not null default '[]'::jsonb,
  format_config_id uuid references public.format_configs(id) on delete set null,
  last_synced_at timestamptz,
  sync_status text not null default 'pending'
    check (sync_status in ('pending','syncing','complete','error')),
  sync_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leagues_sleeper_league_id on public.leagues(sleeper_league_id);
create index if not exists idx_leagues_season on public.leagues(season);
create index if not exists idx_leagues_format_config_id on public.leagues(format_config_id);
create index if not exists idx_leagues_last_synced_at on public.leagues(last_synced_at);

alter table public.leagues enable row level security;

drop policy if exists leagues_select_public on public.leagues;
create policy leagues_select_public on public.leagues
  for select to anon, authenticated using (true);

drop policy if exists leagues_service_role_all on public.leagues;
create policy leagues_service_role_all on public.leagues
  for all to service_role using (true) with check (true);

comment on table public.leagues is
  'Synced Sleeper league metadata for the League Sync feature. Public read; writes only via service_role (scripts/sync-league.ts).';
comment on column public.leagues.metadata is
  'Raw Sleeper /league/{id} object preserved verbatim at sync time. See CLAUDE.md Original Source Object Preservation rule.';
comment on column public.leagues.sync_status is
  'pending | syncing | complete | error. Set to syncing at the start of a sync, complete on success, error with sync_error populated on failure.';
