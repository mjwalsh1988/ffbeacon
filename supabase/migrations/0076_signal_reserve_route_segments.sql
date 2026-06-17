-- Migration 0076: reserve the remaining top-level route segments.
--
-- Phase 7 adds a root-level /{handle} alias for Signal profiles. Next.js route
-- precedence (literal segments beat the dynamic [handle] segment) already
-- prevents a handle from shadowing a real route at runtime. This migration
-- closes the CLAIM-TIME gap: a user must never be able to register a handle
-- that names a real top-level route, otherwise once /u/{handle} -> /{handle}
-- redirects ship that user's profile link would 301 into a real page.
--
-- The 0059 seed already reserved most route segments. These five are the
-- remaining top-level app/ folders that match the handle format and were not
-- yet reserved:
--   players  guides  join  auth  actions
-- (actions is a server-actions folder, not routable, but is reserved anyway so
--  the build-time collision guard can treat every top-level folder uniformly.)
--
-- Data-only INSERT (no DDL), so lib/database.types.ts is unchanged.
-- The code constant lib/signal/reserved-routes.ts (RESERVED_ROUTE_SEGMENTS) is
-- the single source of truth for route segments; this seed mirrors it into the
-- DB, and scripts/check-reserved-routes.ts fails the build if they ever drift.

insert into public.signal_reserved_handles (handle) values
  ('players'),('guides'),('join'),('auth'),('actions')
on conflict (handle) do nothing;
