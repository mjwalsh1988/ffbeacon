-- Migration 0007: news_items
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.players(id) on delete set null,
  headline text not null,
  body text,
  source_url text,
  source_name text,
  impact_score integer,
  ai_summary text,
  published_at timestamptz,
  ingested_at timestamptz not null default now()
);

create index if not exists idx_news_player on public.news_items(player_id);
create index if not exists idx_news_published on public.news_items(published_at desc nulls last);

alter table public.news_items enable row level security;

drop policy if exists news_items_select_public on public.news_items;
create policy news_items_select_public on public.news_items
  for select to anon, authenticated using (true);

drop policy if exists news_items_service_role_all on public.news_items;
create policy news_items_service_role_all on public.news_items
  for all to service_role using (true) with check (true);
