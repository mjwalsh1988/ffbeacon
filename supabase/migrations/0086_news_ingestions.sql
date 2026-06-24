-- Migration 0086: news_ingestions (The Beacon Brief, central pipeline table)
--
-- One row per ingested source post. Our gen_random_uuid() id is the primary
-- identity that every downstream stage (queue jobs, logs, moderation, articles)
-- references. As a safety net against duplicate inserts (cursor hiccups, a
-- source being removed and re-added), source_external_id (the source's native
-- post id) is stored and UNIQUE per source, so the same post can never be
-- inserted twice. A row is inserted only AFTER a source emits its normalized
-- BeaconBriefSourceItem JSON into the pipeline.
--
-- Written and read only through the service-role client (curation cron, queue
-- worker, admin pages behind an is_admin gate). No client-facing access.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.news_ingestions (
  -- OUR identity. Every queue job / log / moderation row references this.
  id uuid primary key default gen_random_uuid(),

  -- Deleting a source cascades its ingestion audit rows (admins can instead
  -- deactivate a source to retain history).
  source_id uuid not null references public.news_sources(id) on delete cascade,
  source_type text not null default 'x',
  -- The source's native post id (e.g. tweet id). Dedup safety net below.
  source_external_id text not null,

  external_url text,
  author_handle text,
  text text,

  -- Normalized media + quoted/retweeted context from the source post.
  media jsonb,
  quoted jsonb,
  retweeted jsonb,

  -- Revision linkage (native edit or AI-linked follow-up).
  is_revision boolean not null default false,
  revision_of_ingestion_id uuid references public.news_ingestions(id) on delete set null,

  -- The structured Anthropic categorize/score result (category, players, teams,
  -- tags, suggested title/slug) and the extracted context score.
  ai_result jsonb,
  context_score integer,

  status text not null default 'new'
    check (status in ('new', 'processing', 'published', 'dropped_no_context', 'revised', 'deleted', 'error')),

  -- The article this post produced (null when context_score = 0 / dropped).
  article_id uuid references public.articles(id) on delete set null,
  -- Which webhook the Discord message went to, and the message id for patching.
  discord_webhook_id uuid references public.discord_webhooks(id) on delete set null,
  discord_message_id text,

  -- Raw source object preserved verbatim (metadata-preservation rule).
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  processed_at timestamptz,

  -- Dedup safety net: a given source post is ingested at most once.
  unique (source_id, source_external_id)
);

-- Per-source reverse-chronological feed (admin Articles/source views).
create index if not exists idx_news_ingestions_source_created
  on public.news_ingestions (source_id, created_at desc);
-- Status filters (pipeline + admin).
create index if not exists idx_news_ingestions_status
  on public.news_ingestions (status);
-- Find the ingestion that produced a given article.
create index if not exists idx_news_ingestions_article
  on public.news_ingestions (article_id);
-- Global reverse-chronological feed.
create index if not exists idx_news_ingestions_created
  on public.news_ingestions (created_at desc);

alter table public.news_ingestions enable row level security;

drop policy if exists news_ingestions_service_role_all on public.news_ingestions;
create policy news_ingestions_service_role_all on public.news_ingestions
  for all to service_role using (true) with check (true);

comment on table public.news_ingestions is
  'Central Beacon Brief table: one row per ingested source post. Our UUID is the identity; UNIQUE(source_id, source_external_id) is the dedup safety net. service_role-only behind an is_admin admin gate.';
