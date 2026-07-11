-- Migration 0132: reserve the 'games' top-level route segment.
--
-- Signal Scout (Phase 4) added app/games/, the first page under the new
-- top-level games segment. scripts/check-reserved-routes.ts fails the build
-- until the segment is present in both lib/signal/reserved-routes.ts
-- (RESERVED_ROUTE_SEGMENTS, updated alongside this migration) and
-- signal_reserved_handles, so a Signal handle can never claim 'games' and
-- collide with the route at the root /{handle} alias.
--
-- Data-only INSERT (no DDL), so lib/database.types.ts is unchanged.

insert into public.signal_reserved_handles (handle) values
  ('games')
on conflict (handle) do nothing;
