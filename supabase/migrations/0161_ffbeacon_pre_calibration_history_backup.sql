-- 0161: point-in-time backup of every FF Beacon value row as it stood before the
-- calibrated-history backfill.
--
-- OPERATIONAL, NOT PERMANENT. This exists so the backfill in
-- scripts/backfill-beacon-calibrated-history.ts is undoable. The backfill
-- rewrites player_value_history.value in place for source='ffbeacon' so the
-- series is on one scale end to end; if anything about it turns out wrong, this
-- table is the way back. Drop it once the new series has been reviewed and
-- trusted.
--
-- It earned its keep during the backfill: a bug left 462 dynasty-ppr-tep-sflex
-- rows in a half-converted state, and restoring exactly those rows from here was
-- what made the fix a five-minute job instead of a re-run of the whole series.
--
-- Taken 2026-08-01: 338,941 rows across 64 snapshots, sum(value) 585,654,370.
--
-- ACCESS MATRIX
--   anon          : none
--   authenticated : none
--   service_role  : ALL
--   client writes : BLOCKED
-- The project auto-enables RLS on new tables with zero policies, which would
-- block everything including the service role, so the policy below is required
-- rather than optional.

create table if not exists public.player_value_history_ffbeacon_pre_calibration as
select * from public.player_value_history where source = 'ffbeacon';

alter table public.player_value_history_ffbeacon_pre_calibration
  enable row level security;

drop policy if exists pvh_ffbeacon_pre_calibration_service_role_all
  on public.player_value_history_ffbeacon_pre_calibration;
create policy pvh_ffbeacon_pre_calibration_service_role_all
  on public.player_value_history_ffbeacon_pre_calibration
  for all to service_role using (true) with check (true);

create index if not exists idx_pvh_ffbeacon_pre_calib_key
  on public.player_value_history_ffbeacon_pre_calibration
  (player_id, format_config_id, captured_at);

comment on table public.player_value_history_ffbeacon_pre_calibration is
  'Backup of source=ffbeacon rows in player_value_history taken 2026-08-01, immediately before the calibrated-history backfill rewrote them onto the calibrated scale. Restore path for that backfill. Safe to drop once the new series is trusted.';
