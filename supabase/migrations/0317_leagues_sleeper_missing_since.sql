-- Migration 0317: first sighting of a league Sleeper says no longer exists
--
-- When a commissioner deletes a league on Sleeper, /v1/league/{id} answers with
-- the literal body null (HTTP 404, measured 2026-09-29). lib/league-removal.ts
-- deletes our copy of such a league, but never on one answer: the first
-- definitive not-found is recorded here, and the league is deleted only when a
-- second one arrives at least an hour later with no successful sync in between
-- (last_pulsed_at later than this stamp voids it, and a sync that finds the
-- league again clears it). A failed request (timeout, 429, 5xx) never writes it.
--
-- No foreign key change was needed for the deletion itself. Every foreign key
-- into public.leagues is already ON DELETE CASCADE (checked against the live
-- schema on 2026-09-29: rosters, league_users, league_transactions,
-- league_matchups, league_drafts, league_activity, league_power_pulse_cache,
-- league_power_rankings_cache, league_positional_war_cache,
-- league_manager_ledger_cache, league_refresh_attempts, community_leagues,
-- league_relay_posts, would_you_rather_trades, and through those the would you
-- rather votes, polls and Discord votes), except
-- positional_war_curves.first_league_id, which is ON DELETE SET NULL on purpose
-- because a curve is shared across leagues by fingerprint.
--
-- Until this is applied the code cannot read the column, and it then records
-- nothing and deletes nothing: a missing column degrades to "keep the league".
--
-- Access matrix (unchanged from the leagues table's existing policies):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (only server code writes this column)
--   client writes : BLOCKED

alter table public.leagues
  add column if not exists sleeper_missing_since timestamptz;

comment on column public.leagues.sleeper_missing_since is
  'First time Sleeper definitively answered that this league does not exist. Cleared when Sleeper serves it again. See lib/league-removal.ts.';
