-- Migration 0005: articles + article_players
--
-- Access matrix:
--   articles
--     anon          : SELECT (only where status='published')
--     authenticated : SELECT (only where status='published')
--     service_role  : ALL
--   article_players
--     anon          : SELECT
--     authenticated : SELECT
--     service_role  : ALL
--   client writes   : BLOCKED on both

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  meta_description text,

  article_type text not null,
  format_config_id uuid references public.format_configs(id),

  tl_dr text,
  content_md text,

  week integer,
  season integer,
  author_id uuid references auth.users(id) on delete set null,

  schema_jsonld jsonb,
  canonical_url text,

  view_count integer not null default 0,

  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  last_updated timestamptz not null default now(),

  created_at timestamptz not null default now()
);

create index if not exists idx_articles_status on public.articles(status);
create index if not exists idx_articles_type on public.articles(article_type);
create index if not exists idx_articles_published_at on public.articles(published_at desc);

create table if not exists public.article_players (
  article_id uuid references public.articles(id) on delete cascade,
  player_id uuid references public.players(id) on delete cascade,
  primary key (article_id, player_id)
);

alter table public.articles enable row level security;
alter table public.article_players enable row level security;

drop policy if exists articles_select_published on public.articles;
create policy articles_select_published on public.articles
  for select to anon, authenticated
  using (status = 'published');

drop policy if exists articles_service_role_all on public.articles;
create policy articles_service_role_all on public.articles
  for all to service_role using (true) with check (true);

drop policy if exists article_players_select_public on public.article_players;
create policy article_players_select_public on public.article_players
  for select to anon, authenticated using (true);

drop policy if exists article_players_service_role_all on public.article_players;
create policy article_players_service_role_all on public.article_players
  for all to service_role using (true) with check (true);
