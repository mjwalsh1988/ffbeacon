-- Migration 0045: beacon_custom_value_cache (on-demand custom-format compute cache)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (the custom-value endpoint reads/writes server-side)
--   client writes : BLOCKED
--
-- Shared compute cache keyed by (descriptor_hash, source_slug). Validity is
-- tied to run_id: a row is fresh while run_id == the latest beacon_value_runs
-- id, with a 24h max-age safety net. The nightly cron evicts rows whose run_id
-- is stale or older than 7 days. The endpoint also keeps an in-memory LRU keyed
-- by descriptor_hash + run_id in front of this table for hot descriptors.

create table if not exists public.beacon_custom_value_cache (
  descriptor_hash text not null,
  source_slug text not null,
  run_id uuid not null,
  computed_at timestamptz not null default now(),
  payload jsonb not null,
  primary key (descriptor_hash, source_slug)
);

create index if not exists idx_beacon_custom_value_cache_run
  on public.beacon_custom_value_cache (run_id);
create index if not exists idx_beacon_custom_value_cache_computed
  on public.beacon_custom_value_cache (computed_at);

alter table public.beacon_custom_value_cache enable row level security;

drop policy if exists beacon_custom_value_cache_service_role_all on public.beacon_custom_value_cache;
create policy beacon_custom_value_cache_service_role_all on public.beacon_custom_value_cache
  for all to service_role using (true) with check (true);

comment on table public.beacon_custom_value_cache is
  'On-demand custom-format compute cache. Fresh while run_id == latest beacon_value_runs id (24h safety). Nightly-evicted. Service-role only.';
