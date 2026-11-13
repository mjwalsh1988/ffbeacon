-- Migration 0378: the /contact and /editorial-policy pages.
--
-- Two new top-level routes, and two small pieces of data each one needs.
--
-- 1. signal_reserved_handles. A Signal handle must never name a real top-level
--    route (lib/signal/reserved-routes.ts, and scripts/check-reserved-routes.ts
--    fails the build when the constant and this table drift). 'contact' has been
--    reserved since 0059; 'editorial-policy' is new. Both are listed so the
--    migration reads as the whole change, and the insert is idempotent.
--
-- 2. guide_pages. The contact page's form posts to /api/guide/submit with
--    page_key 'contact', the same intake the About page's form uses with
--    'about'. The admin review link for a submission is
--    /admin/signal-guide/{page_key}, which needs the page row to exist.
--    Mirrors the new entry in lib/guide/registry.ts.
--
-- Data-only INSERTs (no DDL), so lib/database.types.ts is unchanged and no RLS
-- policy is added or altered. Access to both tables is as it was:
--   signal_reserved_handles : see 0059 (service role writes)
--   guide_pages             : anon and authenticated SELECT, service role ALL

insert into public.signal_reserved_handles (handle) values
  ('contact'),('editorial-policy')
on conflict (handle) do nothing;

insert into public.guide_pages (page_key, title, description, route_example, display_order)
values
  ('contact', 'Contact', 'The contact page.', '/contact', 165)
on conflict (page_key) do nothing;
