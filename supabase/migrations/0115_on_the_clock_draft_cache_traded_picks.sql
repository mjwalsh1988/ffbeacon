-- Migration 0115: add traded_picks to on_the_clock_draft_cache
--
-- Phase 6C.1. The Trade Analyzer must value ANY current draft pick and resolve
-- pick ownership that changed via league trades. Sleeper's /league/{id}/traded_picks
-- is the materialized result of every pick trade (current AND future seasons), so we
-- cache it alongside the draft on each manual sync and shape it to the client.
--
-- Access matrix is INHERITED from migration 0107 (unchanged):
--   anon / authenticated : SELECT only (public Sleeper data; needed for Realtime)
--   service_role         : ALL (writes only via the sync RPCs + service-role route)
--   client writes        : BLOCKED
--
-- The column is nullable with a '[]' default so the claim RPC's bare insert
-- (sleeper_draft_id, sleeper_league_id, season) keeps working and a cold row reads
-- as "no traded picks" rather than null-handling everywhere.

alter table public.on_the_clock_draft_cache
  add column if not exists traded_picks jsonb not null default '[]'::jsonb;

comment on column public.on_the_clock_draft_cache.traded_picks is
  'Cached Sleeper /league/{id}/traded_picks array (season, round, roster_id=original, owner_id=current, previous_owner_id). Refreshed on each manual sync; drives transaction-aware draft-pick ownership in the On The Clock Trade Analyzer. Empty array when none or when the traded-picks fetch failed (partial sync).';
