-- Migration 0266: drop manager_pulse_runs.section_status
--
-- The column was read by the progress panel, the progress route and the admin
-- runs page, and written by nothing, so every reader saw eight sections sitting
-- at "Reading" until the whole report landed (finding F1 in
-- docs/manager-pulse/manager-pulse-audit-and-speed-plan.md). The live report
-- (migration 0262, manager_pulse_live_reports) answers the question the column
-- was standing in for: a real report over the league-seasons finished so far,
-- with its coverage stated in words.
--
-- Applied only after MPS-T019 to MPS-T025 shipped and no code selects the
-- column. Verified with a repo-wide search for section_status immediately
-- before applying.
--
-- Access matrix: unchanged from manager_pulse_runs. No policy change.
--
-- Rollback note:
--   alter table public.manager_pulse_runs add column if not exists section_status jsonb not null default '{}'::jsonb;

alter table public.manager_pulse_runs drop column if exists section_status;
