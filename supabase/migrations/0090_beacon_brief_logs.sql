-- Migration 0090: beacon_brief_logs (The Beacon Brief full event log)
--
-- The end-to-end event feed powering the admin Logs page: every ingest, dedupe,
-- revision-link, AI call (with the EXACT prompt sent and the raw response, model,
-- and token usage), Discord post/patch, deletion check, and error. This is what
-- makes the system fully auditable and the prompts inspectable.
--
-- Written and read only through the service-role client behind an is_admin gate.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.beacon_brief_logs (
  id uuid primary key default gen_random_uuid(),
  -- Kept even if the referenced ingestion/source is later removed.
  ingestion_id uuid references public.news_ingestions(id) on delete set null,
  source_id uuid references public.news_sources(id) on delete set null,
  stage text not null
    check (stage in ('ingest', 'dedupe', 'revision_link', 'revision_triage',
                     'categorize', 'article_write', 'discord_post', 'discord_patch',
                     'deletion_check', 'error')),
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  message text,
  -- For AI stages: the exact prompt/messages sent to Claude.
  request_payload jsonb,
  -- For AI stages: the raw model response (or the Discord/HTTP response).
  response_payload jsonb,
  model text,
  token_usage jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);

-- Global reverse-chronological feed.
create index if not exists idx_beacon_brief_logs_created
  on public.beacon_brief_logs (created_at desc);
-- Per-ingestion timeline.
create index if not exists idx_beacon_brief_logs_ingestion
  on public.beacon_brief_logs (ingestion_id, created_at desc);
-- Stage filter on the Logs page.
create index if not exists idx_beacon_brief_logs_stage
  on public.beacon_brief_logs (stage, created_at desc);
-- Surfacing errors quickly.
create index if not exists idx_beacon_brief_logs_level
  on public.beacon_brief_logs (level, created_at desc);

alter table public.beacon_brief_logs enable row level security;

drop policy if exists beacon_brief_logs_service_role_all on public.beacon_brief_logs;
create policy beacon_brief_logs_service_role_all on public.beacon_brief_logs
  for all to service_role using (true) with check (true);

comment on table public.beacon_brief_logs is
  'End-to-end Beacon Brief event log (ingest -> AI calls with exact prompts + responses -> Discord -> deletion checks -> errors). Powers the admin Logs page. service_role-only behind an is_admin admin gate.';
