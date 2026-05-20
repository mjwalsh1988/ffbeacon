-- Migration 0028: user_preferences slim-down + sleeper_league_settings jsonb
--
-- Access matrix (inherits row-level policies from 0008 — no policy changes):
--   anon          : NONE
--   authenticated : SELECT/INSERT/UPDATE/DELETE own row only
--   service_role  : ALL
--
-- Rationale:
-- 1. Drop columns we never actually read or write in code:
--      - theme (we hard-coded dark in 0009; no toggle ever shipped)
--      - email_digest_enabled (no digest pipeline)
--      - favorite_players (no follow feature; superseded by votes)
-- 2. Consolidate everything Sleeper-related under a single jsonb so adding
--    new Sleeper preferences (featured league, hidden leagues, draft
--    pinning, etc.) doesn't require a new migration each time. The shape
--    is documented in lib/user-preferences-types.ts; here we just enforce
--    that it's a jsonb object (not an array or scalar) via a CHECK.
-- 3. Fold the existing sleeper_username column into the jsonb. Backfill
--    happens in-migration before the column is dropped so no data is lost.

-- Add the new consolidated jsonb column with a default empty object.
alter table public.user_preferences
  add column if not exists sleeper_league_settings jsonb not null default '{}'::jsonb;

-- Enforce that the value is always a JSON object (never null, array, or
-- scalar) so callers can read it without defensive type-checks.
alter table public.user_preferences
  drop constraint if exists user_preferences_sleeper_league_settings_is_object;
alter table public.user_preferences
  add constraint user_preferences_sleeper_league_settings_is_object
  check (jsonb_typeof(sleeper_league_settings) = 'object');

-- Backfill the existing sleeper_username into the new jsonb shape under
-- the `username` key. Done before dropping the column so the migration is
-- safe to run mid-deployment (rows keep their username under the new
-- key).
update public.user_preferences
   set sleeper_league_settings =
         jsonb_build_object('username', sleeper_username)
         || sleeper_league_settings
 where sleeper_username is not null
   and not (sleeper_league_settings ? 'username');

-- Drop the unused legacy columns now that nothing reads them in code.
alter table public.user_preferences
  drop column if exists theme,
  drop column if exists email_digest_enabled,
  drop column if exists favorite_players,
  drop column if exists sleeper_username;

comment on column public.user_preferences.sleeper_league_settings is
  'Consolidated Sleeper-related user preferences. Shape: {
    username?: string,                    -- linked Sleeper handle
    featured_league_id?: string | null,   -- sleeper_league_id pinned to profile (max 1)
    shown_league_ids?: string[]           -- sleeper_league_ids visible on profile
  }. Use jsonb operators (->>, ?, ||) to read/write specific keys without
  clobbering siblings.';

-- Helpful expression index for the common "is this league featured?"
-- lookup once we wire profiles to it.
create index if not exists user_preferences_featured_league_id_idx
  on public.user_preferences ((sleeper_league_settings->>'featured_league_id'))
  where sleeper_league_settings ? 'featured_league_id';
