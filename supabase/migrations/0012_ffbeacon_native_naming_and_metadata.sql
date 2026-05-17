-- Migration 0012: FF Beacon-native naming + per-table metadata jsonb
--
-- Access matrix (unchanged; renames preserve existing policy intent):
--   anon          : SELECT on player_value_history, rankings, projections,
--                   player_stats, news_items, players (public read-only)
--   authenticated : same as anon
--   service_role  : ALL on all of the above (sync scripts)
--   client writes : BLOCKED
--
-- What this migration does:
--   1. Renames trade_values -> player_value_history (table, indexes, policies)
--   2. Drops derived trend columns from player_value_history. They duplicated
--      math that the new player_value_trends table will own (migration 0013).
--      Affected columns: change_7d, change_30d, change_90d, signal,
--      bollinger_position, normalized_value.
--   3. Adds a "metadata" jsonb column to every external-ingestion table:
--      player_value_history, rankings, projections, news_items. Sync scripts
--      must write the raw source payload into this column at insert time.
--   4. Renames player_stats.sleeper_stats -> player_stats.metadata to match
--      the convention.
--   5. Restructures public.players to remove source-named DATA columns
--      (sleeper_raw, ktc_raw, our_metadata). External raw payloads now live
--      in a single jsonb keyed by source slug. Operational/utility columns
--      that describe a specific source-side operation (last_sleeper_sync,
--      last_ktc_sync) are also consolidated into source_synced_at, keyed by
--      source slug. The editorial layer (our_metadata) is renamed to
--      internal_attributes for clarity. All existing data is preserved via
--      a single UPDATE before the old columns are dropped.
--   6. Updates source_registry.data_type[] entries to reference the new
--      table name 'player_value_history' instead of 'trade_values'.

begin;

-- 1. Rename the table -------------------------------------------------------
alter table public.trade_values rename to player_value_history;

-- 2. Drop derived columns (player_value_trends will own these) -------------
alter table public.player_value_history
  drop column if exists change_7d,
  drop column if exists change_30d,
  drop column if exists change_90d,
  drop column if exists signal,
  drop column if exists bollinger_position,
  drop column if exists normalized_value;

-- Rename indexes that still carry the old "values" prefix ------------------
alter index if exists public.idx_values_format
  rename to idx_player_value_history_format;
alter index if exists public.idx_values_player_captured
  rename to idx_player_value_history_player_captured;

-- Rename RLS policies on the renamed table ---------------------------------
alter policy trade_values_select_public on public.player_value_history
  rename to player_value_history_select_public;
alter policy trade_values_service_role_all on public.player_value_history
  rename to player_value_history_service_role_all;

-- Postgres automatically renames the table's PK/unique constraints when the
-- table is renamed in modern versions, but we explicitly normalize the
-- unique-constraint name so future references match the new table.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.player_value_history'::regclass
    and contype = 'u'
    and conname like 'trade_values_%';
  if cname is not null then
    execute format(
      'alter table public.player_value_history rename constraint %I to %I',
      cname,
      replace(cname, 'trade_values', 'player_value_history')
    );
  end if;
end$$;

-- 3. Add metadata jsonb to external-ingestion tables -----------------------
alter table public.player_value_history
  add column if not exists metadata jsonb;
alter table public.rankings
  add column if not exists metadata jsonb;
alter table public.projections
  add column if not exists metadata jsonb;
alter table public.news_items
  add column if not exists metadata jsonb;

comment on column public.player_value_history.metadata is
  'Original raw object from the source for this snapshot. Mandatory at insert time per CLAUDE.md Data Architecture Principles.';
comment on column public.rankings.metadata is
  'Original raw object from the source. Mandatory at insert time per CLAUDE.md Data Architecture Principles.';
comment on column public.projections.metadata is
  'Original raw object from the source. Mandatory at insert time per CLAUDE.md Data Architecture Principles.';
comment on column public.news_items.metadata is
  'Original raw object from the source. Mandatory at insert time per CLAUDE.md Data Architecture Principles.';

-- 4. Rename player_stats.sleeper_stats -> metadata -------------------------
alter table public.player_stats rename column sleeper_stats to metadata;
comment on column public.player_stats.metadata is
  'Original raw object from the source (currently Sleeper). Mandatory at insert time per CLAUDE.md Data Architecture Principles.';

-- 5. Players: consolidate per-source data columns --------------------------
alter table public.players
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists source_synced_at jsonb not null default '{}'::jsonb,
  add column if not exists internal_attributes jsonb not null default '{}'::jsonb;

-- Backfill: copy existing data into the new consolidated columns. Each
-- source's raw payload becomes a key in metadata. Sync timestamps become
-- keys in source_synced_at. The editorial layer (our_metadata) is preserved
-- under internal_attributes.
update public.players
set
  metadata = jsonb_strip_nulls(jsonb_build_object(
    'sleeper', sleeper_raw,
    'ktc', ktc_raw
  )),
  source_synced_at = jsonb_strip_nulls(jsonb_build_object(
    'sleeper', to_jsonb(last_sleeper_sync),
    'ktc', to_jsonb(last_ktc_sync)
  )),
  internal_attributes = coalesce(our_metadata, '{}'::jsonb)
where sleeper_raw is not null
   or ktc_raw is not null
   or last_sleeper_sync is not null
   or last_ktc_sync is not null
   or (our_metadata is not null and our_metadata <> '{}'::jsonb);

alter table public.players
  drop column if exists sleeper_raw,
  drop column if exists ktc_raw,
  drop column if exists last_sleeper_sync,
  drop column if exists last_ktc_sync,
  drop column if exists our_metadata;

comment on column public.players.metadata is
  'Raw source payloads keyed by source slug, e.g. {"sleeper": {...}, "ktc": {...}}. Consolidates the old sleeper_raw / ktc_raw columns.';
comment on column public.players.source_synced_at is
  'Per-source sync timestamps keyed by source slug, e.g. {"sleeper": "2026-05-17T...", "ktc": "..."}.';
comment on column public.players.internal_attributes is
  'FF Beacon editorial / curated attributes (slug overrides, manual tags). Replaces our_metadata.';

-- 6. Refresh source_registry.data_type entries -----------------------------
update public.source_registry
set data_type = (
  select coalesce(
    array_agg(case when t = 'trade_values' then 'player_value_history' else t end),
    array[]::text[]
  )
  from unnest(data_type) as t
)
where 'trade_values' = any(data_type);

commit;
