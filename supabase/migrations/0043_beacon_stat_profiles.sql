-- Migration 0043: beacon_stat_profiles (scoring-invariant per-player stat vector)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (nightly engine writes; custom-value endpoint reads, both via service role)
--   client writes : BLOCKED
--
-- Materialized nightly from player_stats so on-demand custom-format compute is a
-- fast linear combination of the descriptor's scoring weights with each player's
-- component vector, instead of re-reading raw weekly stats per request. Covers
-- skill scoring plus kicking and team-defense categories. No IDP categories
-- registered yet (door left open: components is jsonb, so adding IDP later is
-- data, not a migration). This is a DERIVED table, so no metadata jsonb.

create table if not exists public.beacon_stat_profiles (
  player_id uuid primary key references public.players(id) on delete cascade,
  components jsonb not null default '{}'::jsonb,
  games integer,
  recency jsonb,
  updated_at timestamptz not null default now()
);

alter table public.beacon_stat_profiles enable row level security;

drop policy if exists beacon_stat_profiles_service_role_all on public.beacon_stat_profiles;
create policy beacon_stat_profiles_service_role_all on public.beacon_stat_profiles
  for all to service_role using (true) with check (true);

comment on table public.beacon_stat_profiles is
  'Scoring-invariant per-player stat-component aggregates (skill + kicking + team-defense; no IDP yet). Materialized nightly; powers fast on-demand custom-format compute. Derived table, no metadata column.';
