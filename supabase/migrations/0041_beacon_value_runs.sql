-- Migration 0041: beacon_value_runs (per-recalc audit + observability)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (engine writes; admin reads, both via service role)
--   client writes : BLOCKED
--
-- One row per recalculate-beacon run. id is the run_id used everywhere: it is
-- minted at run start (gen_random_uuid default, never null, never reused) and
-- embedded in the custom-format cache keys so a new nightly run ages out stale
-- hot-cache entries automatically.
--
-- Observability fields surfaced in /admin/beacon:
--   source_freshness : per-source { fresh, considered, newest_captured_at,
--                      cutoff_days, dropped_for_staleness } so a quiet upstream
--                      outage is visible, not invisible.
--   skipped_no_signal: count of (player, format) skipped because every base
--                      signal was stale or missing (prior row left standing).
--   factor_saturated : count of factor-clamp hits (a sign weights are too hot).
--   weights_snapshot : the tunable state the run used.

create table if not exists public.beacon_value_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','error')),

  weights_snapshot jsonb,
  source_freshness jsonb,

  players_processed integer,
  rows_written integer,
  skipped_no_signal integer,
  factor_saturated integer,
  ai_calls integer,

  notes text,
  error text
);

create index if not exists idx_beacon_value_runs_started
  on public.beacon_value_runs (started_at desc);
create index if not exists idx_beacon_value_runs_latest_success
  on public.beacon_value_runs (finished_at desc)
  where status = 'success';

alter table public.beacon_value_runs enable row level security;

drop policy if exists beacon_value_runs_service_role_all on public.beacon_value_runs;
create policy beacon_value_runs_service_role_all on public.beacon_value_runs
  for all to service_role using (true) with check (true);

comment on table public.beacon_value_runs is
  'Per recalculate-beacon run audit. id = the run_id embedded in custom-value cache keys. Carries source_freshness, skipped_no_signal, factor_saturated for admin observability.';
