-- Migration 0029: allow multiple drafts per league + season.
--
-- 0027 added `unique (league_id, season)` on the assumption that Sleeper
-- publishes exactly one draft per league per season. That is not always true:
-- a league can expose more than one draft for the same season (e.g. a startup
-- plus a supplemental draft, or a re-created draft that Sleeper assigns a new
-- draft_id). The pulseLeague upsert keys on `sleeper_draft_id` (the real
-- natural key, already UNIQUE), so a second draft with a new id for an existing
-- (league, season) blew up with:
--   duplicate key value violates unique constraint "league_drafts_league_id_season_key"
--
-- Drop the over-strict constraint. `unique (sleeper_draft_id)` remains the
-- identity, and the non-unique idx_league_drafts_league_season index (from
-- 0027) is kept for query performance. The read path (loadLeagueDraftSlots)
-- already tolerates multiple rows per season.
--
-- Access matrix unchanged (public SELECT; service-role writes).

alter table public.league_drafts
  drop constraint if exists league_drafts_league_id_season_key;

comment on table public.league_drafts is
  'Synced Sleeper draft metadata for the League Pulse feature. One row per Sleeper draft (sleeper_draft_id); a league + season may have more than one. The slot_to_roster_id column drives pick-slot labels (e.g. "1.04") on the roster and transaction views.';
