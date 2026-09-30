-- Migration 0316: when a league's rosters last changed
--
-- Power Pulse (12 hour TTL) and the trade-value power rankings (24 hour TTL)
-- are both computed from who owns whom, and their gates knew only about time
-- and the NFL week. A trade or a waiver claim left both describing rosters that
-- no longer existed until the clock ran out.
--
-- pulseLeagueCore (lib/league-pulse.ts) now compares the rosters Sleeper
-- returns with the stored ones (player ids, injured reserve, taxi squad, draft
-- pick ownership; lib/league-roster-change.ts) and stamps this column when they
-- differ. Both gates treat a cache row generated before it as stale, so the
-- league recomputes on the pass that saw the change. Still on demand only,
-- through the league view: no cron reads this column.
--
-- Null means no change on record, which leaves both gates exactly as they were.
-- The code reads and writes this column through an untyped view and degrades to
-- "no change" on any error, so it is safe on either side of this migration.
--
-- Access matrix (unchanged from the leagues table's existing policies):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (only server code writes this column)
--   client writes : BLOCKED

alter table public.leagues
  add column if not exists rosters_changed_at timestamptz;

comment on column public.leagues.rosters_changed_at is
  'When the league sync last saw rosters differ from the stored copy (players, reserve, taxi, pick ownership). Power Pulse and trade-value rankings treat an older cache row as stale.';
