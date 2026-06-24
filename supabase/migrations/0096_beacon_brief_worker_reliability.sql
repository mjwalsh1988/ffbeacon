-- Migration 0096: Beacon Brief worker reliability + Discord pacing settings
--
-- Three editable tunables for the queue worker (category 'beacon_brief',
-- service_role-only via the existing beacon_settings RLS). No schema change, so
-- no type regeneration is required (these are data rows on beacon_settings).
--
--   bb_worker_max_runtime_ms     : soft wall-clock budget for one worker run.
--                                  Once exceeded the worker stops processing and
--                                  releases any claimed-but-untouched jobs back to
--                                  pending so the next run (or another concurrent
--                                  run) picks them up. Keeps a run well under the
--                                  300s function limit and the 60s cron cadence.
--   bb_stale_processing_minutes  : a job stuck in 'processing' longer than this
--                                  (its worker crashed/timed out) is reclaimed at
--                                  the start of the next run via the normal
--                                  backoff path (attempts++, retry or fail+email).
--   bb_discord_pace_ms           : minimum delay between consecutive Discord sends
--                                  within a run, so a burst never trips the webhook
--                                  rate limit. 0 disables pacing.

insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('bb_worker_max_runtime_ms', '50000'::jsonb, 'number', 'beacon_brief', 'Worker max runtime (ms)',
   'Soft wall-clock budget for one worker run. When exceeded the worker stops and releases any claimed jobs it did not reach back to pending. Keeps each run under the function timeout and the once-a-minute cadence.'),
  ('bb_stale_processing_minutes', '10'::jsonb, 'number', 'beacon_brief', 'Stale processing reaper (minutes)',
   'A job left in processing longer than this (its worker crashed or timed out) is reclaimed at the start of the next run and retried through the normal backoff. Must be well above a healthy run time.'),
  ('bb_discord_pace_ms', '1000'::jsonb, 'number', 'beacon_brief', 'Discord pacing (ms)',
   'Minimum delay between consecutive Discord sends in a single worker run so a burst never trips the webhook rate limit. 0 disables pacing.')
on conflict (key) do nothing;
