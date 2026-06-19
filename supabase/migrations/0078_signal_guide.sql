-- Migration 0078: Signal Guide (per-page help system)
--
-- The Signal Guide is the public, admin-authored help layer that sits on every
-- user-facing page. A page declares a stable page_key (e.g. 'rankings',
-- 'player-profile', 'league-overview'); admins attach two kinds of entries to it:
--   * kind = 'question' : a "how do I / what is this" Q&A. heading = the question,
--                         body = the answer. Surfaced in the panel's
--                         "Understand the Signal" section.
--   * kind = 'term'     : a metric/term definition. heading = the term or metric,
--                         body = the explanation. Surfaced in the panel's
--                         "Metrics & Terms Decoded" section.
--
-- guide_pages is the enumerable registry of pages so the admin index can list
-- every page (even ones with zero content) with its counts. The canonical key set
-- lives in lib/guide/registry.ts and is seeded below; adding a page later means
-- one registry entry plus one seed row.
--
-- is_published gates whether an entry shows in the PUBLIC panel. The public read
-- path (anon/authenticated) only sees published rows, so the floating launcher
-- button only appears on a page that has at least one published entry. Admins read
-- all rows (published or not) through the service-role client.
--
-- These are internal admin-authored content tables, not external-source ingestion,
-- so they intentionally carry no `metadata` jsonb column.
--
-- Access matrix (guide_pages):
--   anon          : SELECT all rows (page titles are not sensitive)
--   authenticated : SELECT all rows
--   service_role  : ALL (admin manage UI writes via service role only)
--
-- Access matrix (guide_entries):
--   anon          : SELECT only is_published = true
--   authenticated : SELECT only is_published = true
--   service_role  : ALL (admin manage UI writes via service role only)

create table if not exists public.guide_pages (
  id uuid primary key default gen_random_uuid(),
  page_key text not null unique
    check (char_length(page_key) between 1 and 60 and page_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  route_example text check (route_example is null or char_length(route_example) <= 200),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.guide_entries (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.guide_pages(id) on delete cascade,
  kind text not null check (kind in ('question', 'term')),
  heading text not null check (char_length(heading) between 1 and 200),
  body text not null check (char_length(body) between 1 and 5000),
  display_order integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The public panel reads a page's published entries grouped by kind, in order; the
-- admin manager reads all entries for a page grouped by kind, in order. This index
-- covers both.
create index if not exists idx_guide_entries_page_kind_order
  on public.guide_entries(page_id, kind, display_order);

alter table public.guide_pages enable row level security;
alter table public.guide_entries enable row level security;

drop policy if exists guide_pages_select_public on public.guide_pages;
create policy guide_pages_select_public on public.guide_pages
  for select to anon, authenticated
  using (true);

drop policy if exists guide_pages_service_role_all on public.guide_pages;
create policy guide_pages_service_role_all on public.guide_pages
  for all to service_role using (true) with check (true);

-- Public read is limited to published entries so unpublished drafts never leak and
-- the launcher's content-gate (button hidden when no published entries) is honored.
drop policy if exists guide_entries_select_public on public.guide_entries;
create policy guide_entries_select_public on public.guide_entries
  for select to anon, authenticated
  using (is_published = true);

drop policy if exists guide_entries_service_role_all on public.guide_entries;
create policy guide_entries_service_role_all on public.guide_entries
  for all to service_role using (true) with check (true);

-- There is deliberately NO insert/update/delete policy for anon or authenticated:
-- all guide content is admin-only and every write goes through a requireAdmin server
-- action using the service-role client.

-- Seed the canonical page registry (keys/titles mirror lib/guide/registry.ts). Idempotent
-- on page_key so re-running never duplicates a page and never clobbers admin-edited copy.
insert into public.guide_pages (page_key, title, description, route_example, display_order)
values
  ('home', 'Home', 'The FF Beacon landing page.', '/', 10),
  ('rankings', 'Rankings', 'The global player rankings table.', '/rankings', 20),
  ('tools', 'Tools', 'The tools hub index.', '/tools', 30),
  ('league-pulse', 'League Pulse', 'Sleeper league lookup entry point.', '/tools/league-pulse', 40),
  ('faab', 'FAAB Calculator', 'The FAAB bid helper tool.', '/tools/faab', 50),
  ('guides', 'Guides', 'The written guides index.', '/guides', 60),
  ('player-profile', 'Player Profile', 'An individual player profile page.', '/players/[slug]', 70),
  ('league-overview', 'League Overview', 'A synced league deep view.', '/leagues/[id]', 80),
  ('league-team', 'Team Roster', 'A single team roster inside a league.', '/leagues/[id]/teams/[roster]', 90),
  ('league-transactions', 'League Transactions', 'A league transactions feed.', '/leagues/[id]/transactions', 100),
  ('dashboard', 'My Beacon Dashboard', 'The signed-in dashboard home.', '/my-beacon', 110),
  ('my-rankings', 'My Rankings', 'A user''s own ranking boards.', '/my-beacon/rankings', 120),
  ('my-profile', 'Edit Profile', 'The signed-in profile editor.', '/my-beacon/profile', 125),
  ('my-signal', 'My Signal Profile', 'The creator profile editor.', '/my-beacon/signal', 130),
  ('account', 'Account', 'Account and security settings.', '/my-beacon/account', 140),
  ('sleeper-leagues', 'My Sleeper Leagues', 'The saved Sleeper leagues list.', '/my-beacon/sleeper-leagues', 145),
  ('creator-profile', 'Creator Profile', 'A public creator Signal profile.', '/[handle]', 150),
  ('about', 'About', 'The about page.', '/about', 160),
  ('author', 'Author', 'The author page.', '/author/michael', 170)
on conflict (page_key) do nothing;
