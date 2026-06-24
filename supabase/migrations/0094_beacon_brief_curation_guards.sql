-- Migration 0094: Beacon Brief curation safeguards + worker tuning settings
--
-- Adds the cold-start / backlog / freshness controls (all editable in the
-- Settings tab, category 'beacon_brief'), plus a worker heavy-bucket cap.
-- Also sets bb_enabled to false: the system stays OFF until the owner turns it
-- on deliberately. Inherits beacon_settings RLS (service_role only).
--
--   bb_backfill_count          : on a source's first poll, how many recent posts
--                                to process. 0 (default) = cold-start watches
--                                from now and processes nothing on init.
--   bb_max_items_per_run       : cap on items the curation cron processes per run
--                                so a stale cursor cannot dump a huge backlog.
--   bb_max_post_age_minutes    : posts older than this are skipped for Discord and
--                                article creation (stale news never gets blasted).
--                                0 = no age cutoff.
--   bb_article_jobs_per_run    : worker cap on heavy article_write/deletion_check
--                                jobs claimed per run (separate from the Discord cap).

insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('bb_backfill_count', '0'::jsonb, 'number', 'beacon_brief', 'Backfill count on new source',
   'When a source is first added, how many of its most recent posts to process. 0 means watch from now and process nothing on the first poll.'),
  ('bb_max_items_per_run', '50'::jsonb, 'number', 'beacon_brief', 'Max items per curation run',
   'Maximum posts the curation cron processes across all sources in a single run, so a stale cursor cannot dump a large backlog at once.'),
  ('bb_max_post_age_minutes', '180'::jsonb, 'number', 'beacon_brief', 'Max post age (minutes)',
   'Posts older than this are skipped for Discord and article creation, so stale news is never posted as if it just broke. 0 disables the cutoff.'),
  ('bb_article_jobs_per_run', '5'::jsonb, 'number', 'beacon_brief', 'Article/heavy jobs per worker run',
   'Maximum heavy jobs (article writing, deletion checks) the worker claims per run. Kept low because each article write makes slow AI calls.')
on conflict (key) do nothing;

-- Keep the system OFF until deliberately enabled.
update public.beacon_settings set value = 'false'::jsonb, updated_at = now() where key = 'bb_enabled';
