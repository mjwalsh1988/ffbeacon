-- Migration 0134: lock try_claim_league_refresh EXECUTE to service_role
-- Finding: FFB-SEC-007 (and the RPC portion of FFB-SEC-004).
--
-- Security invariant:
--   The atomic per-league refresh cooldown RPC is trusted server-side plumbing. It
--   must NOT be directly executable by the anon or authenticated PostgREST roles.
--   The public refresh feature stays available to everyone, but through the trusted
--   Next.js route (app/api/leagues/[league_id]/refresh/route.ts), which calls this
--   RPC via the service-role client on the visitor's behalf.
--
-- Why: the RPC is SECURITY DEFINER, writes the service-role-only league_refresh_attempts
-- ledger, and records triggered_by_user_id from a parameter. With anon/authenticated
-- EXECUTE grants, any holder of the publishable key could call it directly to (a) occupy
-- a league's cooldown slot (griefing the shared limit) and (b) write a spoofed actor id
-- into the audit ledger. Revoking EXECUTE removes both. The route now derives the actor
-- id server-side from the session cookie (null for guests) and passes triggered_via
-- 'public', so the ledger identity is no longer attacker-controlled.
--
-- This does NOT restrict the public feature: guests never needed direct RPC access.
--
-- Idempotent: revoke is safe to re-run. service_role and the DB owner retain EXECUTE.
--
-- Rollback note (no down migration ships): to revert, re-grant EXECUTE to authenticated
-- (grant execute on function public.try_claim_league_refresh(uuid, uuid, text, int) to
-- authenticated). Reverting re-enables direct RPC griefing and audit spoofing.

revoke execute on function public.try_claim_league_refresh(uuid, uuid, text, int)
  from anon, authenticated, public;

comment on function public.try_claim_league_refresh(uuid, uuid, text, int) is
  'Atomic claim of the shared per-league force-refresh cooldown. Returns true if the caller wins the window; false otherwise. service_role-only EXECUTE (migration 0134): the public /api/leagues/[id]/refresh route calls it via the service-role client. Refresh is intentionally public; the shared per-league cooldown is the protection. triggered_by_user_id is derived server-side from the session (null for guests), never from an untrusted caller.';
