-- Migration 0032: cron_runs
--
-- Append-only ledger of every scheduled cron invocation (the nightly value
-- syncs, the derived recalc, the seasonal stats sync). Each run records when it
-- started/finished, its status, a structured JSON result (row counts, durations)
-- and any error message, so the admin panel can answer "did last night's crons
-- run, and did they succeed?" without inspecting data freshness by hand.
--
-- Written exclusively by the cron route handlers via lib/cron-runs.ts
-- recordCronRun(), which uses the service-role client. Read exclusively by the
-- admin panel server pages, which also use the service-role client AFTER
-- verifying the caller is an admin. There is therefore no client-facing access
-- path, so the table is service-role-only (no anon/authenticated policies).
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  -- Stable job identifier matching CRON_JOBS[].name in lib/cron-runs.ts
  -- (e.g. "sync-ktc", "recalculate-derived").
  job_name text not null,
  -- running -> the invocation is in flight (or was killed before finishing).
  -- success / error / skipped are terminal. "skipped" is a clean success that
  -- intentionally did no work (e.g. the off-season stats sync short-circuits).
  status text not null check (status in ('running', 'success', 'error', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  -- The handler's own JSON return value (row counts, per-format breakdown,
  -- durations). Preserved verbatim so the log view can surface real numbers.
  result jsonb,
  error text,
  created_at timestamptz not null default now()
);

-- Latest-run-per-job lookups (dashboard health panel) and per-job log filters.
create index if not exists idx_cron_runs_job_started
  on public.cron_runs (job_name, started_at desc);
-- Global reverse-chronological feed (the cron logs page).
create index if not exists idx_cron_runs_started
  on public.cron_runs (started_at desc);

alter table public.cron_runs enable row level security;

-- No anon/authenticated policies, table is service-role-only. The admin panel
-- reads it through the service-role client behind an is_admin gate.
drop policy if exists cron_runs_service_role_all on public.cron_runs;
create policy cron_runs_service_role_all on public.cron_runs
  for all to service_role using (true) with check (true);

comment on table public.cron_runs is
  'Append-only ledger of scheduled cron invocations. Written by cron route handlers (service-role) via lib/cron-runs.ts; read by the admin panel behind an is_admin gate. service_role-only.';
