-- Reserve the 'season' handle, for the new top-level route.
--
-- Access matrix: unchanged. signal_reserved_handles is SELECT public, writes
-- service_role only (migration 0059).
--
-- WHY. `/season` is a new top-level app/ folder (Season Pulse), and the
-- root-level `/{handle}` alias means a Signal handle could otherwise be
-- claimed with the same name. Next.js route precedence stops it shadowing the
-- real page at runtime, so the risk is at CLAIM time: a reader who registered
-- 'season' would have a profile at /u/season whose canonical /{handle} link
-- 301s into the Season Pulse hub instead of at them. Nobody held the handle
-- when this was written (checked 2026-10-03).
--
-- The code constant `lib/signal/reserved-routes.ts RESERVED_ROUTE_SEGMENTS` is
-- the single source of truth; this seed mirrors it into the table the 0068
-- claim-time trigger enforces. `scripts/check-reserved-routes.ts` fails the
-- build if the folder, the constant and this table drift apart.
--
-- Data-only INSERT (no DDL), so lib/database.types.ts is unchanged.
insert into public.signal_reserved_handles (handle) values
  ('season')
on conflict (handle) do nothing;
