-- Migration 0154: survive an X API outage without losing the deletion watch
--
-- On 2026-07-31 the X developer account ran out of API credits and every call
-- started returning HTTP 402 (credits depleted). Three separate weaknesses turned
-- one billing event into a day of silence plus 30 alert emails:
--
--   1. The deletion watch was a self-perpetuating chain. handleDeletionCheck only
--      enqueued the NEXT check after a successful X call, so once the calls
--      started failing the chain snapped and no article was ever re-checked
--      again, even after credits were restored.
--   2. Nothing distinguished "X is refusing to serve us" from "this one post
--      could not be fetched". Every deletion_check burned its 5 retries and sent
--      its own failure email, so one root cause produced 30 identical alerts.
--   3. Each check read exactly one post per HTTP request even though the lookup
--      endpoint takes 100 ids, and every article was re-read every 6 hours for 7
--      days (28 reads per article). X meters reads per RESOURCE RETURNED, so that
--      cadence, not the polling frequency, was the real spend. The schedule is now
--      two checkpoints (1 hour and 7 days), which matters more than it looks:
--      article volume spikes during the season, and this cost is per article.
--
-- This migration adds the state those fixes need. The behaviour lives in
-- lib/x.ts, lib/beacon-brief/health.ts, lib/beacon-brief/deletion.ts and
-- lib/beacon-brief/worker.ts.
--
-- Access matrix (both objects):
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED
-- beacon_brief_health is internal operations state written only by the cron
-- workers. The admin UI reads it through the service-role client like every other
-- Beacon Brief admin surface, so no authenticated policy is needed.

-- ---------------------------------------------------------------------------
-- 1. Integration health / alert throttle state
-- ---------------------------------------------------------------------------

create table if not exists public.beacon_brief_health (
  component text primary key,
  status text not null default 'ok'
    check (status in ('ok', 'outage')),
  -- Classified reason for the current outage: 'credits' | 'auth' | 'rate_limit'
  -- | 'transient'. Null while healthy. Set from lib/x.ts classification.
  error_kind text,
  error_detail text,
  http_status integer,
  failing_since timestamptz,
  last_success_at timestamptz,
  -- While in outage the pipeline stops calling X except for one probe per
  -- bb_x_probe_interval_minutes, so a depleted balance cannot be hammered.
  last_probe_at timestamptz,
  -- One alert per bb_alert_cooldown_minutes. suppressed_alerts counts what the
  -- cooldown swallowed so the next mail can say how many it stands in for.
  last_alert_at timestamptz,
  suppressed_alerts integer not null default 0,
  consecutive_failures integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.beacon_brief_health is
  'Per-component health for the Beacon Brief pipeline. Doubles as the alert throttle: one email per component per cooldown window instead of one per failed job. Components: x_api (the X read integration), queue_failures (permanently failed queue jobs).';
comment on column public.beacon_brief_health.last_probe_at is
  'While status=outage the pipeline makes at most one X call per probe interval to test recovery. Everything else is skipped so a depleted balance is never hammered.';
comment on column public.beacon_brief_health.suppressed_alerts is
  'Alerts the cooldown swallowed since last_alert_at. Reset to 0 whenever an alert is actually sent.';

alter table public.beacon_brief_health enable row level security;

drop policy if exists beacon_brief_health_service_role_all on public.beacon_brief_health;
create policy beacon_brief_health_service_role_all
  on public.beacon_brief_health
  for all
  to service_role
  using (true)
  with check (true);

insert into public.beacon_brief_health (component, status)
values ('x_api', 'ok'), ('queue_failures', 'ok')
on conflict (component) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Deletion watch becomes state-driven instead of chained
-- ---------------------------------------------------------------------------

-- When this post was last confirmed to still exist at the source. The sweep
-- derives what is due from this plus the article's age, so an outage delays the
-- watch instead of ending it: whatever is overdue is simply picked up next time.
alter table public.news_ingestions
  add column if not exists deletion_checked_at timestamptz;

comment on column public.news_ingestions.deletion_checked_at is
  'Last time the source post was confirmed to still exist. Null means never checked. The deletion sweep (lib/beacon-brief/deletion.ts) selects rows whose next tapered checkpoint has passed, so a failed run never breaks the schedule.';

-- Supports the sweep predicate: published rows with an article, inside the watch
-- window, ordered by how overdue they are.
create index if not exists idx_news_ingestions_deletion_watch
  on public.news_ingestions (created_at desc)
  where article_id is not null and status = 'published';

-- ---------------------------------------------------------------------------
-- 3. New queue job type for the batched sweep
-- ---------------------------------------------------------------------------

-- deletion_check stays valid so any historical row still reads correctly; the
-- worker no longer creates them. deletion_sweep replaces it: one job checks every
-- overdue post in batches of 100 ids per request.
alter table public.beacon_brief_queue
  drop constraint if exists beacon_brief_queue_job_type_check;
alter table public.beacon_brief_queue
  add constraint beacon_brief_queue_job_type_check
  check (job_type in ('discord_post', 'discord_patch', 'article_write', 'deletion_check', 'deletion_sweep'));

-- ---------------------------------------------------------------------------
-- 4. Settings
-- ---------------------------------------------------------------------------

-- beacon_settings.value_type is constrained to number | boolean | string, so the
-- tapered schedule ships as a comma-separated string (same shape as
-- bb_keyword_filter) and stays editable on the admin Settings page.
insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_deletion_watch_days', '7'::jsonb, 'number',
   'Deletion watch window (days)',
   'How long after ingestion a post stays under deletion watch. Past this age it is never re-checked.'),
  ('beacon_brief', 'bb_deletion_check_hours', '"1,168"'::jsonb, 'string',
   'Deletion check schedule (hours)',
   'Comma-separated checkpoints, in hours after ingestion, at which a post is re-verified. Replaces the old fixed every-6-hours cadence: 2 reads per article instead of 28. The 1-hour check catches a reporter pulling a post they got wrong, which is when nearly all deletions happen; the 7-day check is a last look before the post leaves the watch window. X bills per post read, so each extra checkpoint is a recurring cost multiplied by article volume, and volume spikes in season.'),
  ('beacon_brief', 'bb_deletion_sweep_interval_minutes', '60'::jsonb, 'number',
   'Deletion sweep interval (minutes)',
   'How often the batched deletion sweep runs. Each run checks every post whose next checkpoint has passed, 100 ids per request.'),
  ('beacon_brief', 'bb_deletion_sweep_max_ids', '300'::jsonb, 'number',
   'Deletion sweep batch ceiling',
   'Ceiling on posts re-verified in one sweep, so a long backlog drains over several runs instead of one large bill.'),
  ('beacon_brief', 'bb_x_probe_interval_minutes', '15'::jsonb, 'number',
   'X recovery probe interval (minutes)',
   'While the X integration is in outage, how long to wait between single probe calls that test for recovery. Every other X call is skipped.'),
  ('beacon_brief', 'bb_alert_cooldown_minutes', '360'::jsonb, 'number',
   'Alert email cooldown (minutes)',
   'Minimum gap between alert emails for the same component. Stops one root cause from sending one email per failed job.')
on conflict (key) do nothing;
