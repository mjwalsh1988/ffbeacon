-- Migration 0114: lock On The Clock SECURITY DEFINER RPCs to service_role EXECUTE only
--
-- Gotcha found during Phase 1 verification: `revoke all on function ... from public`
-- (in 0110/0111/0113) removes only the PUBLIC pseudo-role grant. Supabase's project
-- default privileges ALSO grant EXECUTE to anon and authenticated explicitly, so those
-- two roles retained EXECUTE on every On The Clock RPC. Because these are SECURITY
-- DEFINER functions, that would let an anon caller (with the publishable/anon key)
-- invoke them directly -- e.g. cleanup_on_the_clock_cache to wipe the cache, or
-- claim_on_the_clock_sync to grief a draft's sync lock.
--
-- Every On The Clock RPC is called server-side via createAdminClient() (service_role).
-- The browser never calls them. So we explicitly revoke EXECUTE from public, anon, and
-- authenticated, and (re)grant only service_role. Idempotent and safe to replay.

revoke all on function public.claim_on_the_clock_sync(text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.claim_on_the_clock_sync(text, text, text, int, int) to service_role;

revoke all on function public.complete_on_the_clock_sync(text, int, text) from public, anon, authenticated;
grant execute on function public.complete_on_the_clock_sync(text, int, text) to service_role;

revoke all on function public.release_on_the_clock_sync(text) from public, anon, authenticated;
grant execute on function public.release_on_the_clock_sync(text) to service_role;

revoke all on function public.try_claim_on_the_clock_lookup(text, text, int) from public, anon, authenticated;
grant execute on function public.try_claim_on_the_clock_lookup(text, text, int) to service_role;

revoke all on function public.cleanup_on_the_clock_cache(int, int) from public, anon, authenticated;
grant execute on function public.cleanup_on_the_clock_cache(int, int) to service_role;
