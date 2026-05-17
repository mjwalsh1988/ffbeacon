-- Migration 0003: rankings + trade_values + projections
--
-- Access matrix (all three tables):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.rankings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  format_config_id uuid not null references public.format_configs(id),
  overall_rank integer not null,
  position_rank integer not null,
  tier integer,
  source text not null,
  week integer,
  season integer not null,
  confidence text,
  trend text,
  notes text,
  generated_at timestamptz not null default now(),
  unique(player_id, format_config_id, source, week, season)
);

create index if not exists idx_rankings_format on public.rankings(format_config_id);
create index if not exists idx_rankings_player on public.rankings(player_id);
create index if not exists idx_rankings_week on public.rankings(season, week);

create table if not exists public.trade_values (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  format_config_id uuid not null references public.format_configs(id),
  value numeric not null,
  normalized_value numeric,
  change_7d numeric,
  change_30d numeric,
  change_90d numeric,
  signal text,
  bollinger_position numeric,
  source text not null,
  captured_at timestamptz not null default now(),
  unique(player_id, format_config_id, source, captured_at)
);

create index if not exists idx_values_format on public.trade_values(format_config_id);
create index if not exists idx_values_player_captured on public.trade_values(player_id, captured_at desc);

create table if not exists public.projections (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  format_config_id uuid not null references public.format_configs(id),
  week integer not null,
  season integer not null,
  projected_points numeric not null,
  floor_points numeric,
  ceiling_points numeric,
  start_sit_verdict text,
  confidence text,
  reasoning text,
  generated_at timestamptz not null default now(),
  unique(player_id, format_config_id, week, season)
);

create index if not exists idx_projections_week on public.projections(season, week, format_config_id);

alter table public.rankings enable row level security;
alter table public.trade_values enable row level security;
alter table public.projections enable row level security;

drop policy if exists rankings_select_public on public.rankings;
create policy rankings_select_public on public.rankings
  for select to anon, authenticated using (true);
drop policy if exists rankings_service_role_all on public.rankings;
create policy rankings_service_role_all on public.rankings
  for all to service_role using (true) with check (true);

drop policy if exists trade_values_select_public on public.trade_values;
create policy trade_values_select_public on public.trade_values
  for select to anon, authenticated using (true);
drop policy if exists trade_values_service_role_all on public.trade_values;
create policy trade_values_service_role_all on public.trade_values
  for all to service_role using (true) with check (true);

drop policy if exists projections_select_public on public.projections;
create policy projections_select_public on public.projections
  for select to anon, authenticated using (true);
drop policy if exists projections_service_role_all on public.projections;
create policy projections_service_role_all on public.projections
  for all to service_role using (true) with check (true);
