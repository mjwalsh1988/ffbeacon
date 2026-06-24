-- Migration 0082: news_sources (The Beacon Brief)
--
-- The external accounts the Beacon Brief monitors. Source-agnostic by design:
-- source_type defaults to 'x' today but the CHECK list is meant to grow as new
-- ingestors are added. Each row carries the polling cursor (the source's native
-- "since" id) and a quick last-poll status so the admin Sources page can show
-- whether the most recent curation run for that source succeeded or failed.
--
-- Written and read only through the service-role client (the curation cron and
-- the admin Sources page behind an is_admin gate). No client-facing access.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.news_sources (
  id uuid primary key default gen_random_uuid(),
  -- Internal label for the admin's own documentation.
  admin_label text not null,
  -- Pipeline kind. Extend this CHECK list when a new ingestor lands.
  source_type text not null default 'x' check (source_type in ('x')),
  -- The source handle (e.g. an X handle without the @).
  handle text not null,
  -- The source's resolved native account id (e.g. X numeric user id),
  -- populated on first successful poll. Operational mapping, not data.
  external_account_id text,
  is_active boolean not null default true,
  -- The source's native pagination cursor (e.g. X since_id) for incremental polls.
  last_cursor text,
  last_polled_at timestamptz,
  last_poll_status text check (last_poll_status in ('success', 'error', 'skipped')),
  last_poll_error text,
  -- Raw source object / config preserved per the metadata-preservation rule.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A source account should appear once per pipeline kind.
  unique (source_type, handle)
);

-- Active-source iteration for the curation cron and the admin list.
create index if not exists idx_news_sources_active
  on public.news_sources (is_active, source_type);

alter table public.news_sources enable row level security;

drop policy if exists news_sources_service_role_all on public.news_sources;
create policy news_sources_service_role_all on public.news_sources
  for all to service_role using (true) with check (true);

comment on table public.news_sources is
  'External accounts the Beacon Brief curation cron monitors (X first; source_type CHECK is extensible). Holds the poll cursor and last-poll status. service_role-only behind an is_admin admin gate.';
