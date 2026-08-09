-- Migration 0184: take league_metadata out of public reach.
--
-- WHY (this corrects a claim made in 0180's own header)
-- 0180 said the raw Sleeper league object "carries no user email, no auth
-- identity, and nothing the league page does not already show." That is wrong.
-- Sleeper's GET /league/{id} also returns the league CHAT tail:
-- last_message_text, last_message_attachment, last_author_display_name,
-- last_author_id, and last_message_time. `SleeperLeague` in lib/sleeper.ts is a
-- partial TypeScript declaration and strips nothing at runtime, so the whole
-- body is stored.
--
-- on_the_clock_draft_cache is public-SELECT by design (it holds public draft
-- data), so anyone with the publishable key could
--   select sleeper_league_id, league_metadata from on_the_clock_draft_cache
-- and read the most recent chat line and its author for every league ever
-- synced, in one query. Sleeper's own endpoint is unauthenticated, so none of
-- this is secret in absolute terms. The new harm is ENUMERATION: our table turns
-- "know one league id, read one league" into "read every cached league at once".
--
-- The fix withholds the column rather than dropping it, because the
-- raw-source-preservation rule is worth keeping and the data is genuinely useful
-- for backfills and diagnosis. PostgREST honours column privileges, so:
--   - the service-role read path (lib/on-the-clock/cache.ts shapeMeta) is
--     unaffected and still whitelists scoring_settings / roster_positions /
--     playoff settings onto the wire,
--   - a public `select *` now fails on this column rather than returning it.
--
-- ACCESS MATRIX after this migration
--   anon           SELECT on every column EXCEPT league_metadata
--   authenticated  the same
--   service_role   ALL, including league_metadata
--   anon/auth      INSERT/UPDATE/DELETE: still blocked (no policy grants writes)

-- A column-level REVOKE is a no-op while a table-level SELECT grant stands: the
-- table grant already implies every column, including ones added later. The only
-- way to withhold one column is to drop the table grant and re-grant the rest
-- explicitly. Verified against prod: after this, information_schema.column_privileges
-- shows SELECT on league_metadata for service_role only.
--
-- MAINTENANCE NOTE: a new column on this table is NOT publicly readable until it
-- is added to both grant lists below. That is the deliberate trade for keeping
-- the raw league object; a forgotten column fails closed.
revoke select on public.on_the_clock_draft_cache from anon;
revoke select on public.on_the_clock_draft_cache from authenticated;

grant select (
  sleeper_draft_id,
  sleeper_league_id,
  season,
  draft_status,
  draft_type,
  pick_count,
  metadata,
  league_users,
  rosters,
  traded_picks,
  last_synced_at,
  sync_locked_until,
  created_at,
  updated_at
) on public.on_the_clock_draft_cache to anon;

grant select (
  sleeper_draft_id,
  sleeper_league_id,
  season,
  draft_status,
  draft_type,
  pick_count,
  metadata,
  league_users,
  rosters,
  traded_picks,
  last_synced_at,
  sync_locked_until,
  created_at,
  updated_at
) on public.on_the_clock_draft_cache to authenticated;

comment on column public.on_the_clock_draft_cache.league_metadata is
  'Raw Sleeper league object (GET /league/{id}) captured at sync time. Source of scoring_settings and roster_positions for the points-based draft features. NOT publicly readable: it also carries Sleeper''s league-chat tail (last_message_text, last_author_display_name), and a public column here would let one query enumerate that across every synced league. Read it through the service role only.';
