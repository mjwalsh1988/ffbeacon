-- Migration 0262: manager_pulse_live_reports (the report while it is still filling in)
--
-- Keyed by SUBJECT (the manager being looked up) and window, not by run. Two
-- readers who look up the same handle two minutes apart share one live
-- document and it is computed once per checkpoint, which is the whole point of
-- letting a second reader JOIN a capture rather than start one.
--
-- Never promoted to manager_pulse_cache: the final report is written by
-- finalizeManagerPulseRun from the full run, and manager_pulse_tendencies is
-- written only there. Nothing downstream may read a partial opinion.
--
-- Access matrix
--   anon          : none
--   authenticated : none (the report route reads it with the service role after
--                   checking the run belongs to the caller)
--   service_role  : ALL
--
-- Rollback note:
--   drop table if exists public.manager_pulse_live_reports;
--   alter table public.manager_pulse_runs drop column if exists live_checkpoint_done;
--   alter table public.manager_pulse_runs drop column if exists live_checkpoint_at;

create table if not exists public.manager_pulse_live_reports (
  sleeper_user_id text not null,
  season_from int not null,
  season_to int not null,
  model_version text not null,
  report jsonb not null,
  coverage int not null default 0,
  coverage_total int not null default 0,
  version int not null default 0,
  computed_at timestamptz not null default now(),
  primary key (sleeper_user_id, season_from, season_to, model_version),
  constraint manager_pulse_live_reports_coverage_sane
    check (coverage >= 0 and coverage_total >= coverage)
);

comment on table public.manager_pulse_live_reports is
  'The Manager Pulse report computed over the league-seasons finished so far, one row per subject and window, overwritten at each checkpoint. Service-role only. Never the source of manager_pulse_cache or manager_pulse_tendencies.';

alter table public.manager_pulse_live_reports enable row level security;

drop policy if exists manager_pulse_live_reports_service_role_all
  on public.manager_pulse_live_reports;
create policy manager_pulse_live_reports_service_role_all
  on public.manager_pulse_live_reports
  for all to service_role using (true) with check (true);

revoke all on table public.manager_pulse_live_reports from anon, authenticated;

-- The checkpoint ledger lives on the run, since checkpoints are counted per run
-- and the version is read per subject.
alter table public.manager_pulse_runs
  add column if not exists live_checkpoint_done int not null default 0,
  add column if not exists live_checkpoint_at timestamptz;

comment on column public.manager_pulse_runs.live_checkpoint_done is
  'leagues_done at the last live-report checkpoint this run triggered.';
