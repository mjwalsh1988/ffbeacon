-- Migration 0206: make the calibration drift alert mean something again
--
-- SETTINGS ONLY. No table, no column, no function, no data row outside
-- beacon_settings. Every threshold below is admin-editable at
-- /admin/beacon/calibration and takes effect on the next drift check.
--
-- ACCESS MATRIX
--   beacon_settings   unchanged by this migration (service_role write, admin
--                     read through the service-role client behind an is_admin
--                     gate). No new grants, no new policies.
--
-- WHY
-- The drift check emailed on 13 of its first 24 nights, and on 6 of the last 6.
-- An alarm that fires most days is not an alarm. Two things were wrong with it,
-- and neither was the check itself: the thresholds, and the trigger.
--
-- THE THRESHOLDS WERE MEASURED ON THE WRONG BOARDS
-- The numbers in migration 0160 came with their evidence attached ("observed
-- maximum was 48", "never observed at any tested reference age"). Those
-- observations were taken on dynasty boards in the offseason. Dynasty is still
-- behaving exactly as they predicted: 20 to 32 points of average movement, a
-- largest single move of 210, nobody over 250. Redraft is not, and should not be
-- expected to. A redraft reference is built from two sources over ~181 shared
-- players, and in August a one-year board reprices on every depth-chart report.
-- Measured over the same 24 nights:
--
--   dynasty-ppr-sflex   mean 20-32   max 210   0 over 250    spearman 0.9942+
--   redraft-ppr-sflex   mean 52-94   max 542   7.8-10.0%     spearman 0.9993+
--   redraft-ppr-std     mean 34-74   max 736   2.2-4.7%      spearman 0.9930+
--
-- So redraft gets its own four thresholds, keyed off format_configs.league_type
-- rather than a per-format list, because the split is not about these two boards
-- in particular. It is about how long a roster is held, and any future one-year
-- board will want the same numbers. The dynasty set stays where it was except
-- for the rank correlation, which is raised from 0.995 to 0.993: dynasty tripped
-- it four times at 0.9942 to 0.9948 while moving the average player 26 points,
-- which is a limit sitting inside the noise rather than above it.
--
-- THE TRIGGER WAS A SINGLE NIGHT
-- Widening thresholds far enough that one bad night never fires would make the
-- check useless. The real signal was never one night: it was the same board
-- tripping three nights running while the other three stayed quiet. So the email
-- now needs a streak. The numbers are still computed and still recorded every
-- night, and /admin/beacon/calibration still shows the latest ones on demand;
-- only the email waits for persistence.
--
-- Replayed against the 24 nights of history in cron_runs, this pair of changes
-- turns 13 emails into 1: the genuine three-night run on redraft-ppr-sflex
-- (8.7%, 10.0%, 9.4% of the board moving 250+) still reports, and every isolated
-- spike goes quiet.

-- ---------------------------------------------------------------------------
-- Redraft thresholds. Each one sits above the worst value observed on a redraft
-- board over the measured window, with enough headroom that ordinary preseason
-- churn does not reach it and a source publishing something broken does.
-- ---------------------------------------------------------------------------
insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('calibration_drift_redraft_mean_abs', '120'::jsonb, 'number', 'calibration',
   'Redraft drift alert: mean move',
   'Same as the mean-move limit above, for boards whose league_type is redraft. Separate because a one-year board reprices far more than a dynasty one: observed maximum on redraft was 94 against 32 on dynasty.'),
  ('calibration_drift_redraft_player_max', '700'::jsonb, 'number', 'calibration',
   'Redraft drift alert: single player move',
   'Same as the single-player limit above, for redraft boards. Observed maximum was 736 on one night and 350 to 610 on the rest, against 210 on dynasty.'),
  ('calibration_drift_redraft_pct_250', '0.08'::jsonb, 'number', 'calibration',
   'Redraft drift alert: share moving 250+',
   'Same as the share-moving-250 limit above, for redraft boards. Observed range was 0.022 to 0.100, against 0 on dynasty.'),
  ('calibration_drift_redraft_min_spearman', '0.992'::jsonb, 'number', 'calibration',
   'Redraft drift alert: minimum rank correlation',
   'Same as the rank-correlation limit above, for redraft boards. Observed minimum was 0.9930.'),
  ('calibration_drift_alert_streak', '3'::jsonb, 'number', 'calibration',
   'Alert after this many checks in a row',
   'How many consecutive drift checks one board has to trip before it emails. The numbers are computed and recorded every night regardless, and this page always shows the latest; the streak only governs the email. Set to 1 to email on every trip.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The dynasty rank-correlation limit was inside its own noise floor.
-- ---------------------------------------------------------------------------
update public.beacon_settings
   set value = '0.993'::jsonb,
       description = 'Alert when a rebuild would drop the board order correlation below this. Applies to dynasty boards; redraft has its own limit below. Raised from 0.995 to 0.993 after dynasty tripped it four times in 24 nights at 0.9942 to 0.9948 while moving the average player 26 points, which is a limit sitting inside the noise rather than above it.',
       updated_at = now()
 where key = 'calibration_drift_min_spearman';

-- Name the four originals as the dynasty set now that redraft has its own, so
-- the admin page cannot read as though these govern every board.
update public.beacon_settings
   set label = 'Dynasty drift alert: mean move', updated_at = now()
 where key = 'calibration_drift_mean_abs';
update public.beacon_settings
   set label = 'Dynasty drift alert: single player move', updated_at = now()
 where key = 'calibration_drift_player_max';
update public.beacon_settings
   set label = 'Dynasty drift alert: share moving 250+', updated_at = now()
 where key = 'calibration_drift_pct_250';
update public.beacon_settings
   set label = 'Dynasty drift alert: minimum rank correlation', updated_at = now()
 where key = 'calibration_drift_min_spearman';

-- ---------------------------------------------------------------------------
-- The canary list did its job and is now misleading. normalization_method has
-- read 'calibrated' since 2026-08-01, which covers every board, so an empty box
-- no longer means "no format uses the new method". Say what it does now.
-- ---------------------------------------------------------------------------
update public.beacon_settings
   set label = 'Calibrated formats (staged rollout list)',
       description = 'Comma-separated format slugs pinned to calibrated normalization even when the method above is not. This was the staged-rollout control while the method was quantile_median; with the method now set to calibrated it covers every board and this box is redundant. It stays because it is the way back in: if the method is ever rolled back, one slug here keeps one board on the new engine.',
       updated_at = now()
 where key = 'calibration_format_slugs';
