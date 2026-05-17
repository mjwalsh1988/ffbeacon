-- Migration 0010: source_registry + user_preferences.default_source_slug
--
-- Access matrix (source_registry):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED
--
-- Access matrix (user_preferences.default_source_slug column):
--   inherits user_preferences row-level policies from 0008.
--   anon          : NONE
--   authenticated : SELECT/INSERT/UPDATE/DELETE OWN row only
--   service_role  : ALL
--
-- Registry-driven dropdown for which data source backs rankings/trade_values.
-- See /docs/data-sources.md for the source taxonomy and fallback rules.

create table if not exists public.source_registry (
  slug text primary key,
  display_name text not null,
  description text,
  priority integer not null,
  is_active boolean not null default true,
  data_type text[] not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_source_registry_priority
  on public.source_registry(priority)
  where is_active = true;

alter table public.source_registry enable row level security;

drop policy if exists source_registry_select_public on public.source_registry;
create policy source_registry_select_public on public.source_registry
  for select to anon, authenticated using (true);

drop policy if exists source_registry_service_role_all on public.source_registry;
create policy source_registry_service_role_all on public.source_registry
  for all to service_role using (true) with check (true);

insert into public.source_registry (slug, display_name, description, priority, data_type)
values
  ('ktc', 'KTC', 'KeepTradeCut community-sourced trade values', 1, ARRAY['rankings','trade_values'])
on conflict (slug) do nothing;

-- Add default_source_slug to user_preferences (FK to source_registry.slug)
alter table public.user_preferences
  add column if not exists default_source_slug text
  references public.source_registry(slug) on delete set null;
