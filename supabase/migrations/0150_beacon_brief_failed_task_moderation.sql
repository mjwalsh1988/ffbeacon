-- Migration 0150: beacon_brief_moderation failed-task review
--
-- Extends the moderation queue to also hold a permanently-failed
-- beacon_brief_queue job (one that exhausted its retry attempts). The worker
-- (failOrRetry() in lib/beacon-brief/worker.ts) writes a pending row here the
-- moment a job's status flips to 'failed', instead of just sitting silent. The
-- admin then either retries it (the job resets to 'pending' for the worker to
-- pick back up on its next run) or skips it (the job stays 'failed' forever and
-- this row closes with no further action). Only the one failed job is touched;
-- other jobs for the same source post (e.g. an already-succeeded discord_post)
-- are untouched, and the worker's existing per-job idempotency guards (see
-- handleDiscordPost's discord_message_id / discord_webhook_id checks) keep a
-- retried discord job from ever double-posting.
--
-- RLS unchanged: service_role-only behind the admin gate.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED

alter table public.beacon_brief_moderation
  drop constraint if exists beacon_brief_moderation_type_check;
alter table public.beacon_brief_moderation
  add constraint beacon_brief_moderation_type_check
  check (type in ('deletion', 'player_match', 'team_match', 'failed_task'));

alter table public.beacon_brief_moderation
  add column if not exists queue_job_id uuid references public.beacon_brief_queue(id) on delete cascade;

-- Retry/skip look up the failed_task row's job by this column.
create index if not exists idx_beacon_brief_moderation_queue_job
  on public.beacon_brief_moderation (queue_job_id);

comment on column public.beacon_brief_moderation.queue_job_id is
  'For failed_task rows: the beacon_brief_queue job that permanently failed. Retry resets that job to pending; skip leaves it failed and closes this row. Null for every other type.';
