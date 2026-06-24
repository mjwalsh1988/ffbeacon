-- Migration 0087: beacon_brief_queue (The Beacon Brief async job buffer)
--
-- The durable buffer between the fast curation cron (every 5 min) and the queue
-- worker cron (every 1 min). The curation cron only enqueues jobs; the worker
-- claims a small batch with SELECT ... FOR UPDATE SKIP LOCKED (so overlapping
-- worker runs can never grab the same job, removing any need for a separate
-- concurrency lock), executes them, and applies the Discord throttle and
-- exponential backoff. job payloads reference the news_ingestions UUID.
--
-- Written and read only through the service-role client. No client access.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.beacon_brief_queue (
  id uuid primary key default gen_random_uuid(),
  job_type text not null
    check (job_type in ('discord_post', 'discord_patch', 'article_write', 'deletion_check')),
  -- Job-specific data; references the news_ingestions UUID plus any extras.
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  attempts integer not null default 0,
  -- Earliest time the job is eligible to run (backoff pushes this out).
  run_after timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Worker claim query: pending jobs whose run_after has arrived, oldest first.
-- Partial index keeps it tight as done/failed rows accumulate.
create index if not exists idx_beacon_brief_queue_claim
  on public.beacon_brief_queue (run_after)
  where status = 'pending';
-- Admin overview counts by status.
create index if not exists idx_beacon_brief_queue_status
  on public.beacon_brief_queue (status);

alter table public.beacon_brief_queue enable row level security;

drop policy if exists beacon_brief_queue_service_role_all on public.beacon_brief_queue;
create policy beacon_brief_queue_service_role_all on public.beacon_brief_queue
  for all to service_role using (true) with check (true);

comment on table public.beacon_brief_queue is
  'Async job buffer between the Beacon Brief curation cron and the worker cron. Worker claims via FOR UPDATE SKIP LOCKED. service_role-only.';
