-- Migration 0020: rosters
--
-- League Sync feature: per-team row inside a synced league.
-- player_ids stores the current Sleeper roster (string IDs, includes
-- the "0" placeholder for empty slots which sync strips out before write).
-- draft_pick_assets stores enriched pick descriptors with values cached
-- in by scripts/calculate-league-power-rankings.ts.
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.rosters (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  sleeper_roster_id integer not null,
  owner_user_id text,
  co_owners jsonb not null default '[]'::jsonb,
  player_ids jsonb not null default '[]'::jsonb,
  starter_ids jsonb not null default '[]'::jsonb,
  reserve_ids jsonb not null default '[]'::jsonb,
  taxi_ids jsonb not null default '[]'::jsonb,
  draft_pick_assets jsonb not null default '[]'::jsonb,
  wins integer not null default 0,
  losses integer not null default 0,
  ties integer not null default 0,
  points_for numeric not null default 0,
  points_against numeric not null default 0,
  waiver_position integer,
  waiver_budget integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, sleeper_roster_id)
);

create index if not exists idx_rosters_league_id on public.rosters(league_id);
create index if not exists idx_rosters_owner_user_id on public.rosters(owner_user_id);

alter table public.rosters enable row level security;

drop policy if exists rosters_select_public on public.rosters;
create policy rosters_select_public on public.rosters
  for select to anon, authenticated using (true);

drop policy if exists rosters_service_role_all on public.rosters;
create policy rosters_service_role_all on public.rosters
  for all to service_role using (true) with check (true);

comment on table public.rosters is
  'Synced Sleeper rosters for the League Sync feature. One row per (league, sleeper_roster_id).';
comment on column public.rosters.metadata is
  'Raw Sleeper roster object preserved verbatim. See CLAUDE.md Original Source Object Preservation rule.';
comment on column public.rosters.draft_pick_assets is
  'Array of pick descriptors with cached values: {season, round, pick_position, original_roster_id, value_by_format}. Populated by the power-rankings cache job. Empty during initial sync until calculate-trends-style derivation runs.';
