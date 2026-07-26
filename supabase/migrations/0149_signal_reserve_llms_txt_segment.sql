-- Migration 0149: reserve the 'llms.txt' top-level route segment
--
-- Access matrix: inherits signal_reserved_handles (service_role writes; the 0068
-- claim-time trigger reads it). Data-only INSERT, no DDL, so lib/database.types.ts
-- is unchanged.
--
-- Why: /llms.txt is served by app/llms.txt/route.ts. Because the path needs a dot,
-- it has to be a FOLDER rather than a file, unlike sitemap.ts and robots.ts. That
-- makes it a top-level segment under app/, and scripts/check-reserved-routes.ts
-- (correctly) failed the build until it was registered in both places:
--   1. RESERVED_ROUTE_SEGMENTS in lib/signal/reserved-routes.ts (the source of truth)
--   2. this table, which the claim-time trigger enforces
--
-- In practice the Signal handle format almost certainly rejects a dot already, so
-- nobody could have claimed this handle. It is seeded anyway so the build-time
-- collision guard can treat every top-level app/ folder uniformly, which is the same
-- reasoning migration 0076 used when it reserved the non-routable 'actions' folder.

insert into public.signal_reserved_handles (handle) values
  ('llms.txt')
on conflict (handle) do nothing;
