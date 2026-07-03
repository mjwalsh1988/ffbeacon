-- Migration 0119: reserve the 'brief' top-level route segment.
--
-- The Beacon Brief blog added app/brief/ but the segment was never mirrored
-- into signal_reserved_handles, so scripts/check-reserved-routes.ts failed the
-- build (filesystem -> constant leg) and the DB seed leg would also drift on
-- Vercel where Supabase creds are present.
--
-- lib/signal/reserved-routes.ts (RESERVED_ROUTE_SEGMENTS) is the single source
-- of truth; this seed mirrors 'brief' into the DB so the two stay in sync.
--
-- Data-only INSERT (no DDL), so lib/database.types.ts is unchanged.

insert into public.signal_reserved_handles (handle) values
  ('brief')
on conflict (handle) do nothing;
