-- Migration 0002: players
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED
--
-- Pattern: public read-only data per CLAUDE.md.

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,

  external_ids jsonb not null default '{}'::jsonb,

  first_name text not null,
  last_name text not null,
  full_name text generated always as (first_name || ' ' || last_name) stored,
  position text not null,
  team text,
  status text not null default 'active',

  birth_date date,
  -- age is computed at query time (extract(year from age(birth_date))) to keep
  -- the column immutable for storage. Generated columns must be immutable.
  height_inches integer,
  weight_lbs integer,
  college text,
  draft_year integer,
  draft_round integer,
  draft_pick integer,
  years_experience integer,

  our_metadata jsonb not null default '{}'::jsonb,

  sleeper_raw jsonb,
  ktc_raw jsonb,

  last_sleeper_sync timestamptz,
  last_ktc_sync timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_players_position on public.players(position);
create index if not exists idx_players_team on public.players(team);
create index if not exists idx_players_status on public.players(status);

create unique index if not exists idx_players_sleeper_id
  on public.players ((external_ids->>'sleeper'))
  where external_ids ? 'sleeper';

create unique index if not exists idx_players_ktc_id
  on public.players ((external_ids->>'ktc'))
  where external_ids ? 'ktc';

create index if not exists idx_players_external_ids_gin
  on public.players using gin (external_ids);

alter table public.players enable row level security;

drop policy if exists players_select_public on public.players;
create policy players_select_public
  on public.players
  for select
  to anon, authenticated
  using (true);

drop policy if exists players_service_role_all on public.players;
create policy players_service_role_all
  on public.players
  for all
  to service_role
  using (true)
  with check (true);
