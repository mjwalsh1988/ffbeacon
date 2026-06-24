-- Migration 0083: news_categories (The Beacon Brief)
--
-- The fixed-but-editable set of categories the AI must choose from when scoring
-- a post, and the article taxonomy. Each category can carry one or more Discord
-- role ids: when a post is categorized, those roles are mentioned in the Discord
-- message so the right groups get pinged.
--
-- Managed in the admin Categories page and read by the curation pipeline, both
-- through the service-role client. This phase ships admin + pipeline only (the
-- public /articles reader is deferred), so there is no public read policy yet;
-- add a select_public policy when the public reader lands.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.news_categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  -- Discord role ids to mention when a post lands in this category (groups to
  -- ping). Empty = no role mention from the category.
  discord_role_ids text[] not null default '{}',
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ordered, active-first listing for the AI category set and the admin page.
create index if not exists idx_news_categories_order
  on public.news_categories (is_active, display_order);

alter table public.news_categories enable row level security;

drop policy if exists news_categories_service_role_all on public.news_categories;
create policy news_categories_service_role_all on public.news_categories
  for all to service_role using (true) with check (true);

comment on table public.news_categories is
  'Editable Beacon Brief category set + article taxonomy; discord_role_ids drives Discord group pings per category. service_role-only behind an is_admin admin gate (public read deferred with the public reader).';
