-- Migration 0281: reserve the 'llms-full.txt' top-level route segment
--
-- Access matrix: inherits signal_reserved_handles (service_role writes; the 0068
-- claim-time trigger reads it). Data-only INSERT, no DDL, so lib/database.types.ts
-- is unchanged.
--
-- Why: /llms-full.txt is served by app/llms-full.txt/route.ts, the companion corpus
-- to /llms.txt. Exactly the same shape as migration 0149: the path needs a dot, so
-- it has to be a FOLDER rather than a file, which makes it a top-level segment under
-- app/ and requires registering in both places before the build will pass:
--   1. RESERVED_ROUTE_SEGMENTS in lib/signal/reserved-routes.ts (the source of truth)
--   2. this table, which the claim-time trigger enforces
--
-- As with 0149, the Signal handle format almost certainly rejects a dot already, so
-- nobody could have claimed this handle. It is seeded anyway so the build-time
-- collision guard can treat every top-level app/ folder uniformly.

insert into public.signal_reserved_handles (handle) values
  ('llms-full.txt')
on conflict (handle) do nothing;
