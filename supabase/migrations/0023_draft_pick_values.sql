-- Migration 0023: draft_pick_values
--
-- Time-series of dynasty/startup draft pick values per format and source.
-- Independent of leagues, used both for the League Sync power-rankings
-- calc (assign value to "2026 Mid 1st" assets) and for any future
-- standalone pick-rankings tool.
--
-- Naming follows CLAUDE.md Hybrid Rule:
--   source = source slug from source_registry (e.g. 'ktc'), an
--   operational identifier, not a data column.
-- The raw scraped payload lives in metadata jsonb.
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.draft_pick_values (
  id uuid primary key default gen_random_uuid(),
  season integer not null,
  round integer not null,
  pick_position text not null
    check (pick_position in ('early','mid','late','unknown')),
  format_config_id uuid not null references public.format_configs(id) on delete cascade,
  source text not null references public.source_registry(slug) on delete cascade,
  value numeric not null,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (season, round, pick_position, format_config_id, source, captured_at)
);

create index if not exists idx_draft_pick_values_lookup
  on public.draft_pick_values(season, round, pick_position, format_config_id, source, captured_at desc);
create index if not exists idx_draft_pick_values_source on public.draft_pick_values(source);
create index if not exists idx_draft_pick_values_captured_at on public.draft_pick_values(captured_at desc);

alter table public.draft_pick_values enable row level security;

drop policy if exists draft_pick_values_select_public on public.draft_pick_values;
create policy draft_pick_values_select_public on public.draft_pick_values
  for select to anon, authenticated using (true);

drop policy if exists draft_pick_values_service_role_all on public.draft_pick_values;
create policy draft_pick_values_service_role_all on public.draft_pick_values
  for all to service_role using (true) with check (true);

comment on table public.draft_pick_values is
  'Time-series of draft pick values per (season, round, pick_position, format, source). Snapshots from external sources (KTC, FantasyCalc, etc).';
comment on column public.draft_pick_values.pick_position is
  'early (slots 1-4) | mid (slots 5-8) | late (slots 9-12) | unknown. Matches the bucketing scheme used by KTC and most community sources.';
comment on column public.draft_pick_values.metadata is
  'Raw source pick object (e.g. KTC player record where is_pick=true). See CLAUDE.md Original Source Object Preservation rule.';

-- Register the data_type on source_registry rows that publish pick values.
-- This is additive; sources still need their own sync script to populate.
update public.source_registry
  set data_type = array(select distinct unnest(data_type || array['draft_pick_values']))
  where slug = 'ktc';
