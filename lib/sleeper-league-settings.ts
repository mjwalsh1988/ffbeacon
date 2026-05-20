/**
 * Typed accessors for `user_preferences.sleeper_league_settings` (jsonb).
 *
 * Migration 0028 consolidated everything Sleeper-related into one jsonb
 * column so we stop accumulating per-feature columns. Use these helpers
 * everywhere instead of poking at the jsonb directly so the shape stays
 * consistent and we never accidentally clobber sibling keys.
 *
 * Shape (kept in sync with the column comment in migration 0028):
 *   {
 *     username?: string,                  // linked Sleeper handle
 *     featured_league_id?: string | null, // sleeper_league_id pinned to profile
 *     shown_league_ids?: string[]         // sleeper_league_ids visible on profile
 *   }
 */
export type SleeperLeagueSettings = {
  username?: string | null;
  featured_league_id?: string | null;
  shown_league_ids?: string[];
};

/**
 * Coerce an unknown jsonb value into the typed settings shape. Treats
 * anything that isn't a plain object (null, array, string, etc.) as an
 * empty settings record so callers never need to defensively type-check.
 */
export function parseSleeperLeagueSettings(value: unknown): SleeperLeagueSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const out: SleeperLeagueSettings = {};

  if (typeof record.username === "string" && record.username.length > 0) {
    out.username = record.username;
  } else if (record.username === null) {
    out.username = null;
  }

  if (typeof record.featured_league_id === "string" && record.featured_league_id.length > 0) {
    out.featured_league_id = record.featured_league_id;
  } else if (record.featured_league_id === null) {
    out.featured_league_id = null;
  }

  if (Array.isArray(record.shown_league_ids)) {
    out.shown_league_ids = record.shown_league_ids.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
  }

  return out;
}

/**
 * Merge a partial settings patch over the current value and return a new
 * record. Pass `null` for a key to clear it explicitly; omitting a key
 * leaves the existing value untouched.
 */
export function mergeSleeperLeagueSettings(
  current: SleeperLeagueSettings,
  patch: SleeperLeagueSettings,
): SleeperLeagueSettings {
  const merged: SleeperLeagueSettings = { ...current };
  for (const key of Object.keys(patch) as (keyof SleeperLeagueSettings)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    // Preserve the type: assigning `value as never` keeps the destination
    // index narrowed to its own key's type without per-branch casts.
    (merged as Record<string, unknown>)[key] = value as unknown;
  }
  return merged;
}
