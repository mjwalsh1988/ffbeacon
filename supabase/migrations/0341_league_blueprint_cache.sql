-- Migration 0341: Team Blueprint cache and roster age history
--
-- league_blueprint_cache holds ONE stored BlueprintView per (league, roster,
-- season, source): the page renders it, and both share images read it and
-- never run an engine, so a page and its picture show the same numbers by
-- construction. Rebuilt in place when its fingerprint or TTL says so
-- (lib/league-blueprint/cache.ts). Written only for rosters somebody viewed.
-- Pruned past 14 days by /api/cron/league-maintenance (one DELETE).
--
-- league_roster_age_history tracks each viewed roster's age profile, one small
-- row per roster per Eastern day, so a later "age over time" chart has data
-- from launch (owner decision 18.3). Nothing reads it yet. Pruned past 730
-- days by the same maintenance run.
--
-- Plan of record: docs/team-blueprint/team-blueprint-plan.md section 7.2.
-- Derived tables built from internal data, so no metadata column.
--
-- ACCESS MATRIX
--
--   table                       anon/authenticated   service_role
--   league_blueprint_cache      none                 all
--   league_roster_age_history   select               all
--
-- The cache is read and written by the page and the image routes through the
-- admin client only. Age history is derived league data, the same class as
-- league_power_rankings_cache, so it is public read. No client writes.

create table if not exists public.league_blueprint_cache (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  -- Sleeper roster_id.
  roster_id integer not null,
  season text not null,
  format_config_id uuid not null references public.format_configs(id) on delete cascade,
  source text not null,
  -- BlueprintView (lib/league-blueprint/types.ts). Server-written, rendered as text.
  view jsonb not null,
  fingerprint text not null,
  model_version integer not null,
  generated_at timestamptz not null default now(),
  unique (league_id, roster_id, season, source)
);

create index if not exists idx_league_blueprint_cache_league_generated
  on public.league_blueprint_cache (league_id, generated_at desc);

-- The 14-day prune deletes by age.
create index if not exists idx_league_blueprint_cache_generated
  on public.league_blueprint_cache (generated_at);

alter table public.league_blueprint_cache enable row level security;

drop policy if exists league_blueprint_cache_service_role_all on public.league_blueprint_cache;
create policy league_blueprint_cache_service_role_all
  on public.league_blueprint_cache
  for all to service_role
  using (true)
  with check (true);

create table if not exists public.league_roster_age_history (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  roster_id integer not null,
  season text not null,
  as_of_day date not null,
  -- {QB:{mine,league,count}, RB:..., WR:..., TE:..., roster: number, league: number}
  ages jsonb not null,
  unique (league_id, roster_id, as_of_day)
);

create index if not exists idx_league_roster_age_history_roster
  on public.league_roster_age_history (league_id, roster_id, as_of_day desc);

-- The 730-day prune deletes by day.
create index if not exists idx_league_roster_age_history_day
  on public.league_roster_age_history (as_of_day);

alter table public.league_roster_age_history enable row level security;

drop policy if exists league_roster_age_history_select_public on public.league_roster_age_history;
create policy league_roster_age_history_select_public
  on public.league_roster_age_history
  for select to anon, authenticated
  using (true);

drop policy if exists league_roster_age_history_service_role_all on public.league_roster_age_history;
create policy league_roster_age_history_service_role_all
  on public.league_roster_age_history
  for all to service_role
  using (true)
  with check (true);
