-- Migration 0204: reserve the 'sitemap.xml' and 'sitemaps' top-level route segments
--
-- Access matrix: inherits signal_reserved_handles (service_role writes; the 0068
-- claim-time trigger reads it). Data-only INSERT, no DDL, so lib/database.types.ts
-- is unchanged.
--
-- Why: the sitemap was one file at app/sitemap.ts, served through Next's metadata
-- convention. It is now an index at app/sitemap.xml/route.ts plus four per-section
-- files under app/sitemaps/, because that convention emits a urlset and has no way to
-- emit a sitemap index, and the split is what lets Search Console report coverage per
-- kind of page instead of one number for a thousand mixed URLs.
--
-- A convention FILE is not a route segment; a folder is. So both new folders are
-- top-level segments under app/ and scripts/check-reserved-routes.ts (correctly)
-- failed the build until they were registered in both places:
--   1. RESERVED_ROUTE_SEGMENTS in lib/signal/reserved-routes.ts (the source of truth)
--   2. this table, which the claim-time trigger enforces
--
-- Same reasoning as migration 0149 for 'llms.txt'. The handle format almost certainly
-- rejects a dot already, so nobody could have claimed 'sitemap.xml', but it is seeded
-- anyway so the guard can treat every top-level app/ folder uniformly.

insert into public.signal_reserved_handles (handle) values
  ('sitemap.xml'),
  ('sitemaps')
on conflict (handle) do nothing;
