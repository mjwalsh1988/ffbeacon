-- Migration 0021: league_users
--
-- League Sync feature: Sleeper user profile per league.
-- One row per (league, sleeper_user_id). Sleeper user IDs are public
-- (visible on every Sleeper profile), so reads are public.
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.league_users (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  sleeper_user_id text not null,
  display_name text,
  avatar text,
  team_name text,
  is_owner boolean not null default false,
  is_commissioner boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, sleeper_user_id)
);

create index if not exists idx_league_users_league_id on public.league_users(league_id);
create index if not exists idx_league_users_sleeper_user_id on public.league_users(sleeper_user_id);

alter table public.league_users enable row level security;

drop policy if exists league_users_select_public on public.league_users;
create policy league_users_select_public on public.league_users
  for select to anon, authenticated using (true);

drop policy if exists league_users_service_role_all on public.league_users;
create policy league_users_service_role_all on public.league_users
  for all to service_role using (true) with check (true);

comment on table public.league_users is
  'Synced Sleeper user profiles per league for the League Sync feature.';
comment on column public.league_users.metadata is
  'Raw Sleeper /league/{id}/users entry preserved verbatim. team_name typically lives under metadata.team_name; we promote it for ergonomics.';
