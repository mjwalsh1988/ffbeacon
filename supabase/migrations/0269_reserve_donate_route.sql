-- Migration 0269: reserve the /donate top-level route segment.
--
-- app/donate/ (the donation page) and app/donate/thanks/ (where Stripe returns
-- a reader after Checkout) add a new literal top-level segment. Next.js route
-- precedence already stops a Signal handle from shadowing it at runtime; this
-- closes the CLAIM-TIME gap, exactly as migrations 0059 and 0076 did for the
-- segments that existed then.
--
-- Without this row, scripts/check-reserved-routes.ts fails the build: leg 1
-- (every top-level app/ folder appears in RESERVED_ROUTE_SEGMENTS) is satisfied
-- by the code change alongside this file, and leg 2 (every entry in that
-- constant appears in signal_reserved_handles) is satisfied here.
--
-- Data-only INSERT, no DDL, so lib/database.types.ts is unchanged.
--
-- ACCESS MATRIX (unchanged by this migration, stated for the record):
--   signal_reserved_handles  SELECT  public read of the reserved list
--                            WRITE   service_role only (migration 0068)

insert into public.signal_reserved_handles (handle) values
  ('donate')
on conflict (handle) do nothing;
