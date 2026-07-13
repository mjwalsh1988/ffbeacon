-- Migration 0136: function search_path pinning + inert RPC grant cleanup
-- Findings: FFB-SEC-015 (mutable search_path), FFB-SEC-016 (inert definer RPCs callable by anon).
--
-- Hygiene / defense-in-depth only. None of these are exploitable under current grants
-- (the four functions below are SECURITY INVOKER with restrictive EXECUTE), but pinning
-- search_path clears the advisor finding and removes a latent definer-hijack surface.
--
-- search_path choice: `public, pg_temp` (not empty) because bb_player_match_candidates
-- relies on pg_trgm operators/functions installed in the public schema; an empty
-- search_path would break trigram search. A fixed value is all the advisor requires.
--
-- pg_trgm relocation out of public is DEFERRED: moving it risks breaking every trigram
-- index/operator and generated search SQL that currently resolves it via public, and it
-- provides no real security gain here. Documented in the remediation report instead.
--
-- Idempotent. No behavior change: only search_path metadata and EXECUTE grants.

-- 1. Pin search_path on the four SECURITY INVOKER functions the advisor flags.
alter function public.signal_links_valid(jsonb) set search_path = public, pg_temp;
alter function public.signal_gif_valid(jsonb) set search_path = public, pg_temp;
alter function public.bb_claim_jobs(integer, text[]) set search_path = public, pg_temp;
alter function public.bb_player_match_candidates(text, integer, real) set search_path = public, pg_temp;

-- 2. Revoke the unnecessary direct EXECUTE on the inert trigger utility rls_auto_enable
--    from the untrusted PostgREST roles (FFB-SEC-016). It runs as a trigger; direct RPC
--    calls are inert but the grant is needless. service_role / owner retain EXECUTE.
--    (user_preferences_block_is_admin_change was already revoked in migration 0133.
--     signal_target_publicly_viewable intentionally keeps anon EXECUTE: RLS uses it.)
--    Note: EXECUTE is also held via the PUBLIC pseudo-role by default, so we must
--    revoke from PUBLIC as well (the same gotcha migration 0114 documented); revoking
--    only anon/authenticated leaves the PUBLIC grant intact. service_role and the owner
--    retain their explicit grants.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
