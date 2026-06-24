-- Migration 0089: article_revisions (The Beacon Brief revision history)
--
-- Append-only snapshots of a Beacon Brief article's content each time the AI
-- rewrites it (a critical revision merge) or an admin edits it. Powers the
-- "view revision history" feature on the admin Articles page. source_ingestion_id
-- records which ingested post triggered the snapshot (null for manual edits).
--
-- Written and read only through the service-role client behind an is_admin gate.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.article_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  -- Monotonic per-article snapshot number (1, 2, 3 ...).
  revision_number integer not null,
  title text,
  content_md text,
  tags text[],
  category_id uuid references public.news_categories(id) on delete set null,
  change_summary text,
  source_ingestion_id uuid references public.news_ingestions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (article_id, revision_number)
);

-- Per-article history, newest first.
create index if not exists idx_article_revisions_article
  on public.article_revisions (article_id, revision_number desc);

alter table public.article_revisions enable row level security;

drop policy if exists article_revisions_service_role_all on public.article_revisions;
create policy article_revisions_service_role_all on public.article_revisions
  for all to service_role using (true) with check (true);

comment on table public.article_revisions is
  'Append-only content snapshots of Beacon Brief articles (AI rewrites + manual edits); powers revision history. service_role-only behind an is_admin admin gate.';
