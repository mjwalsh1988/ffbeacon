-- Migration 0013: player_value_trends pre-calculated table
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (calculate-trends.ts writes via SECRET key)
--   client writes : BLOCKED
--
-- This is a DERIVED table, recalculated by scripts/calculate-trends.ts after
-- every player_value_history sync. It does NOT carry a metadata jsonb column
-- because its data origin is internal calculation, not external ingestion.
-- See CLAUDE.md "Data Architecture Principles" for the rule.
--
-- Read pattern: pages query this table directly for trend indicators rather
-- than recomputing from player_value_history at request time.

create table if not exists public.player_value_trends (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  format_config_id uuid not null references public.format_configs(id),
  source text not null,

  current_value numeric not null,
  value_7d_ago numeric,
  value_30d_ago numeric,
  value_90d_ago numeric,

  change_7d numeric,
  change_7d_pct numeric,
  change_30d numeric,
  change_30d_pct numeric,
  change_90d numeric,
  change_90d_pct numeric,

  trend_7d text check (trend_7d in ('up','down','stable')),
  trend_30d text check (trend_30d in ('up','down','stable')),

  volatility_30d numeric,
  high_30d numeric,
  low_30d numeric,
  data_points_30d integer not null default 0,

  updated_at timestamptz not null default now(),

  unique(player_id, format_config_id, source)
);

create index if not exists idx_player_value_trends_format
  on public.player_value_trends(format_config_id);
create index if not exists idx_player_value_trends_player
  on public.player_value_trends(player_id);
create index if not exists idx_player_value_trends_source
  on public.player_value_trends(source);

alter table public.player_value_trends enable row level security;

drop policy if exists player_value_trends_select_public on public.player_value_trends;
create policy player_value_trends_select_public on public.player_value_trends
  for select to anon, authenticated using (true);

drop policy if exists player_value_trends_service_role_all on public.player_value_trends;
create policy player_value_trends_service_role_all on public.player_value_trends
  for all to service_role using (true) with check (true);

comment on table public.player_value_trends is
  'Pre-calculated per-(player, format, source) value trends. Recalculated by scripts/calculate-trends.ts after each value sync. No metadata jsonb (derived table per CLAUDE.md Data Architecture Principles).';
