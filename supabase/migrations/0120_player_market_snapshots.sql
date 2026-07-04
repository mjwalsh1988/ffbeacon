-- Migration 0120: player_market_snapshots (nightly draft-market snapshots: ADP + projections)
--
-- Access matrix:
--   anon          : SELECT only  (public draft-market data, mirrors player_value_history)
--   authenticated : SELECT only
--   service_role  : ALL          (written only by the nightly sync job / CLI)
--   client writes : BLOCKED (no anon/auth INSERT/UPDATE/DELETE policy exists)
--
-- One row per (source, season_type, season, sleeper_player_id, snapshot_date):
-- a nightly snapshot of a draft-market source's ADP (across every format the
-- source publishes) plus its season-long fantasy point projections for one player.
-- Today the only source is Sleeper's projections endpoint
-- (GET https://api.sleeper.com/projections/nfl/{season}?season_type=regular),
-- which returns a flat stats map carrying adp_* keys (adp_ppr, adp_half_ppr,
-- adp_std, adp_2qb, adp_dynasty_ppr, adp_dynasty_half_ppr, adp_dynasty_std,
-- adp_dynasty_2qb, adp_idp, adp_idp_1qb, adp_rookie, adp_dynasty) and projection
-- points (pts_ppr, pts_half_ppr, pts_std). The value 999 is Sleeper's "no data"
-- sentinel and is stripped at ingest.
--
-- Naming: the table is source-agnostic (no source name in the table name, per the
-- Data Architecture rules); provenance lives in the `source` column. `source` here
-- is NOT part of the source_registry contract (that contract covers rankings /
-- player_value_history); Sleeper deliberately has no source_registry row so it can
-- never appear in the public Source dropdown.
--
-- ADP is stored as a jsonb map keyed by normalized format key (the Sleeper adp_*
-- key without its "adp_" prefix, e.g. {"ppr": 105.3, "dynasty_2qb": 88.1}), so a
-- new format published by the source requires zero schema changes. Projection
-- points get real columns for fast querying. `metadata` preserves the full raw
-- source object per row (audit / backfill / bug diagnosis).
--
-- History is preserved: the nightly job INSERTS a new snapshot_date partition
-- every night (idempotent upsert within one date), it never overwrites prior
-- dates. The player_market_latest view serves fast current lookups.

create table if not exists public.player_market_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'sleeper',
  season integer not null,
  season_type text not null default 'regular',
  snapshot_date date not null,
  sleeper_player_id text not null,
  -- Resolved FF Beacon player, when the external id maps. Kept nullable so an
  -- unmapped market row is still preserved (it can be re-linked later).
  player_id uuid references public.players (id) on delete set null,
  -- Normalized ADP map keyed by format key (999 sentinels stripped). Empty when
  -- the source published no real ADP for this player that night.
  adp jsonb not null default '{}'::jsonb,
  -- Season-long projected fantasy points by scoring type. Null when the source
  -- published no projection for this player.
  projected_pts_ppr numeric,
  projected_pts_half_ppr numeric,
  projected_pts_std numeric,
  -- Full raw source object for this player at this snapshot (never modified).
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, season_type, season, sleeper_player_id, snapshot_date)
);

-- Player history lookups ("this player's ADP over time").
create index if not exists idx_player_market_snapshots_player_date
  on public.player_market_snapshots (player_id, snapshot_date desc);
-- Date-based lookups ("the snapshot nearest this draft's completion date").
create index if not exists idx_player_market_snapshots_source_date
  on public.player_market_snapshots (source, snapshot_date desc);
-- Sleeper-id lookups (rows whose player_id did not resolve yet).
create index if not exists idx_player_market_snapshots_sleeper_id
  on public.player_market_snapshots (sleeper_player_id, snapshot_date desc);

alter table public.player_market_snapshots enable row level security;

drop policy if exists player_market_snapshots_select_public on public.player_market_snapshots;
create policy player_market_snapshots_select_public on public.player_market_snapshots
  for select to anon, authenticated using (true);

drop policy if exists player_market_snapshots_service_role_all on public.player_market_snapshots;
create policy player_market_snapshots_service_role_all on public.player_market_snapshots
  for all to service_role using (true) with check (true);

comment on table public.player_market_snapshots is
  'Nightly per-player draft-market snapshots (ADP across formats as a jsonb map + season projection points) from market sources (today: Sleeper projections endpoint). Historical: one partition per snapshot_date, never overwritten. Public SELECT; writes via the service-role nightly sync only.';

-- Fast "current market" lookups: the newest snapshot row per (source, season_type,
-- player). security_invoker so the underlying table RLS applies to the caller.
create or replace view public.player_market_latest
  with (security_invoker = true) as
  select distinct on (source, season_type, sleeper_player_id) *
  from public.player_market_snapshots
  order by source, season_type, sleeper_player_id, snapshot_date desc;

comment on view public.player_market_latest is
  'Newest player_market_snapshots row per (source, season_type, sleeper_player_id). Read this for current ADP; read the base table for historical lookups.';
