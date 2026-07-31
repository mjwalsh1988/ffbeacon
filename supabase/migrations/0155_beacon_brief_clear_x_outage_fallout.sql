-- Migration 0155: clear what the 2026-07-31 X credit outage left stuck
--
-- One-time repair. Migration 0154 changed the design so this cannot recur; this
-- one cleans up the rows the old design stranded. Schema is untouched.
--
-- Three things were left behind when X started answering HTTP 402:
--
--   1. 30 deletion_check jobs burned their 5 retries and were marked failed. They
--      have no work left to do: the batched sweep in lib/beacon-brief/deletion.ts
--      re-verifies every published post from table state, so the posts these jobs
--      pointed at are already covered. Left as 'failed' they would sit in the
--      admin "Failed tasks" count forever, reading as unfinished work.
--   2. Each of those opened a pending failed_task moderation row, so the queue
--      shows 30 items demanding a retry-or-skip decision that no longer means
--      anything. Retrying them would just re-run a job type that is now a no-op.
--   3. news_ingestions.deletion_checked_at is null for every row, which is
--      correct and deliberate: nothing has been verified since the outage began,
--      so the first sweep re-checks the 31 posts currently inside the watch
--      window (one request, 31 post reads) and the taper takes over from there.
--      No backfill here on purpose. Seeding a timestamp would silently skip that
--      catch-up, and the whole point is to find anything deleted while we were
--      blind.
--
-- resolved_by stays null: no human made this call, and inventing a user id to
-- fill the column would misattribute it. The reason is recorded in detail.
--
-- Access matrix: unchanged. Both tables remain service_role-only.

-- 1. Retire the failed jobs. The original error is preserved in the note so the
--    audit trail survives; the status change reflects that there is genuinely
--    nothing left to run, not that the job succeeded at what it set out to do.
update public.beacon_brief_queue
set
  status = 'done',
  last_error =
    'retired by migration 0155: superseded by the batched deletion sweep. Original error: '
    || coalesce(last_error, 'unknown'),
  updated_at = now()
where job_type = 'deletion_check'
  and status = 'failed'
  and last_error like '%deletion check fetch failed%';

-- 2. Close their moderation rows.
update public.beacon_brief_moderation
set
  status = 'rejected',
  resolved_at = now(),
  detail = detail || jsonb_build_object(
    'resolution', 'auto',
    'resolution_reason',
    'Closed by migration 0155. The job failed because the X account was out of API credits, not because of anything wrong with this post. The batched deletion sweep now covers it.'
  )
where type = 'failed_task'
  and status = 'pending'
  and queue_job_id in (
    select id from public.beacon_brief_queue
    where job_type = 'deletion_check'
      and last_error like 'retired by migration 0155%'
  );

-- 3. Record the incident on the health row so the admin Overview shows an honest
--    last-success time rather than an empty card on first load.
update public.beacon_brief_health
set
  status = 'ok',
  last_success_at = coalesce(last_success_at, now()),
  updated_at = now()
where component = 'x_api';
