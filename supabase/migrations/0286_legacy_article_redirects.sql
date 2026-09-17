-- Migration 0286: legacy_article_redirects
--
-- When the per-post Beacon Brief articles are archived
-- (scripts/archive-legacy-articles.ts, plan section 14.2) each old slug keeps
-- resolving: app/brief/[slug]/page.tsx looks the slug up here when no
-- published article matches and issues a permanent redirect to the Relay
-- permalink for the article's earliest ingestion. Nothing is deleted.
--
-- Written once by the archive script and read by the page through the
-- service-role client (two columns, one row). Service-role only: there is no
-- reason for a client to read a redirect table directly.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED
--
-- Verification (via MCP after apply): pg_policies lists exactly one policy;
-- a select as anon returns permission denied (rolled back).

create table if not exists public.legacy_article_redirects (
  article_slug text primary key,
  relay_slug text not null,
  created_at timestamptz not null default now()
);

alter table public.legacy_article_redirects enable row level security;

drop policy if exists legacy_article_redirects_service_role_all on public.legacy_article_redirects;
create policy legacy_article_redirects_service_role_all on public.legacy_article_redirects
  for all to service_role using (true) with check (true);

-- Supabase grants anon and authenticated table privileges by default; with no
-- policy for them RLS already blocks every row, and revoking the grants makes
-- that explicit (the same belt and braces migration 0283 applied).
revoke all on public.legacy_article_redirects from anon, authenticated;

comment on table public.legacy_article_redirects is
  'Old per-post Beacon Brief article slug to the Relay permalink slug it redirects to. Written once by scripts/archive-legacy-articles.ts.';
