-- Migration 0091: extend articles for The Beacon Brief
--
-- The articles table (0005) now also stores AI-curated Beacon Brief articles, so
-- it gains: metadata (raw source object, per the metadata-preservation rule, as
-- articles now ingest external data), tags (AI-suggested article tags),
-- category_id (the news_categories taxonomy, alongside the legacy article_type
-- text which is kept for back-compat), and origin (how the article was created).
--
-- RLS is unchanged from 0005 (anon/auth SELECT where status='published';
-- service_role ALL; client writes blocked). No policy changes here.

alter table public.articles
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.articles
  add column if not exists tags text[] not null default '{}';

alter table public.articles
  add column if not exists category_id uuid references public.news_categories(id) on delete set null;

alter table public.articles
  add column if not exists origin text not null default 'manual'
    check (origin in ('manual', 'beacon_brief'));

-- Filter articles by category (admin Articles page + future public reader).
create index if not exists idx_articles_category on public.articles(category_id);
-- Filter by how the article was created.
create index if not exists idx_articles_origin on public.articles(origin);

comment on column public.articles.metadata is
  'Raw source object for Beacon Brief articles (metadata-preservation rule); {} for manually authored articles.';
comment on column public.articles.tags is 'AI-suggested article tags (Beacon Brief).';
comment on column public.articles.category_id is 'news_categories taxonomy; article_type text kept for back-compat.';
comment on column public.articles.origin is 'How the article was created: manual or beacon_brief.';
