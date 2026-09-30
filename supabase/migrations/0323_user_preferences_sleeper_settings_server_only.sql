-- Migration 0323: user_preferences.sleeper_league_settings is written by the
-- server only.
--
-- DO NOT APPLY UNTIL THE CODE THAT GOES WITH IT IS DEPLOYED, AND UNTIL EVERY
-- SESSION-CLIENT WRITER OF THIS COLUMN HAS MOVED TO
-- lib/sleeper-league-settings-write.ts. Applied early, the saved-handle form,
-- the featured and shown league toggles on My Beacon, and the Signal featured
-- league list all start failing, because each of them writes this column with
-- the reader's own session.
--
-- Why. `authenticated` held INSERT and UPDATE on this column (so that a reader
-- could own their own preferences), which let an account owner PATCH the jsonb
-- directly through PostgREST. That skipped app/actions/sleeper-handle.ts
-- saveSleeperHandle, the one action that resolves a handle on Sleeper before
-- storing it, and let the owner assert any Sleeper user id. Code that trusts
-- the saved id (the Signal Check import's league ownership check, the League
-- Pulse roster match) then agreed with whatever was asserted.
--
-- After this, the browser can still READ its own row (unchanged select policy)
-- and still insert and update every OTHER column it held a grant on. Only this
-- column loses its INSERT and UPDATE grants, for anon, authenticated and
-- PUBLIC (a revoke from PUBLIC alone leaves Supabase's named grants in place).
-- The service role, which the server writer uses, is unaffected.
--
-- Access matrix for user_preferences after this migration
--   anon          : SELECT per existing policies; no writes
--   authenticated : SELECT own row; INSERT and UPDATE own row on every granted
--                   column EXCEPT sleeper_league_settings; DELETE per existing
--                   policies
--   service_role  : ALL

revoke insert (sleeper_league_settings), update (sleeper_league_settings)
  on public.user_preferences
  from public, anon, authenticated;
