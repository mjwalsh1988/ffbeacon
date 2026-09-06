-- Migration 0268: document the saved Sleeper identity keys.
--
-- user_preferences.sleeper_league_settings gains four keys beside `username`,
-- written only by app/actions/sleeper-handle.ts saveSleeperHandle after the
-- handle resolved on Sleeper. No schema change, no RLS change: the column,
-- its owner-only policies and its grants are exactly as migration 0028 left
-- them. This file exists so the column comment stays in sync with
-- lib/sleeper-league-settings.ts, which is the rule that file states.
--
-- Access matrix (unchanged):
--   user_preferences : SELECT/INSERT/UPDATE/DELETE own row only; no anon access

comment on column public.user_preferences.sleeper_league_settings is
  'Sleeper-related preferences, one jsonb so per-feature columns stop accumulating. Keys: '
  'username (text, the saved Sleeper handle, normalized to lowercase by saveSleeperHandle; Sleeper resolves handles case-insensitively), '
  'sleeper_user_id (text, resolved from Sleeper at save time), '
  'sleeper_display_name (text, from Sleeper at save time), '
  'sleeper_avatar (text or null, Sleeper avatar id at save time), '
  'handle_verified_at (ISO timestamp of the last successful resolution), '
  'featured_league_id, shown_league_ids, signal_league_ids (unchanged, see 0028).';
