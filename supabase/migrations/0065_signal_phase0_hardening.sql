-- Migration 0065: Phase 0 security hardening (advisor remediation)
--
-- Clears the Supabase security advisor warnings introduced by the Signal Phase 0
-- schema:
--   1. citext relocated out of the public schema into extensions (lint 0014).
--   2. The broad public SELECT policy on the signal-media bucket is dropped. A
--      public bucket serves object URLs without an RLS SELECT policy, and the
--      broad policy let clients LIST every file in the bucket (lint 0025). The
--      owner-scoped write policies remain; public reads happen via the public
--      object URL, and the server reads via service_role.
--   3. EXECUTE on the two Signal trigger functions is revoked from anon and
--      authenticated so they cannot be invoked directly over PostgREST RPC
--      (lints 0028/0029). Trigger execution does not require EXECUTE, so the
--      triggers still fire normally on insert/delete.

alter extension citext set schema extensions;

drop policy if exists signal_media_select_public on storage.objects;

revoke execute on function public.signal_posts_enforce_limits() from public, anon, authenticated;
revoke execute on function public.signal_follows_sync_count() from public, anon, authenticated;
