/**
 * Typed accessors for `user_preferences.sleeper_league_settings` (jsonb).
 *
 * Migration 0028 consolidated everything Sleeper-related into one jsonb
 * column so we stop accumulating per-feature columns. Use these helpers
 * everywhere instead of poking at the jsonb directly so the shape stays
 * consistent and we never accidentally clobber sibling keys.
 *
 * Shape (kept in sync with the column comments in migrations 0028 and 0268):
 *   {
 *     username?: string,                  // linked Sleeper handle, lowercased
 *     sleeper_user_id?: string,           // resolved from Sleeper at save time
 *     sleeper_display_name?: string,      // from Sleeper at save time
 *     sleeper_avatar?: string | null,     // Sleeper avatar id at save time
 *     handle_verified_at?: string,        // ISO time of the last resolution
 *     featured_league_id?: string | null, // sleeper_league_id pinned to profile
 *     shown_league_ids?: string[],        // sleeper_league_ids visible on profile
 *     signal_league_ids?: string[]        // ordered sleeper_league_ids featured on
 *                                         // the public Signal profile (/u/[handle]).
 *                                         // Order is the display order; only ids
 *                                         // already synced into the leagues table
 *                                         // render (the public page never calls
 *                                         // Sleeper).
 *   }
 *
 * The five identity keys are written only by app/actions/sleeper-handle.ts
 * saveSleeperHandle, after the handle resolved on Sleeper. They are read only
 * through lib/sleeper-handle/resolve.ts; lib/sleeper-handle/guard.test.ts
 * fails the suite on any other read.
 */
export type SleeperLeagueSettings = {
  username?: string | null;
  sleeper_user_id?: string | null;
  sleeper_display_name?: string | null;
  sleeper_avatar?: string | null;
  handle_verified_at?: string | null;
  featured_league_id?: string | null;
  shown_league_ids?: string[];
  signal_league_ids?: string[];
};

/** The keys migration 0268 documents beside `username`, all plain strings. */
const IDENTITY_KEYS = [
  "sleeper_user_id",
  "sleeper_display_name",
  "sleeper_avatar",
  "handle_verified_at",
] as const;

/** Sleeper user ids are digit strings. This one reaches a URL path segment. */
const SLEEPER_USER_ID_PATTERN = /^[0-9]{1,32}$/;

/** Matches lib/sleeper-avatar-url.ts, which builds the URL from this value. */
const SLEEPER_AVATAR_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

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

  // The four identity keys coerce the way `username` does: a non-empty string
  // is kept, an explicit null is kept as a clear, anything else is dropped so a
  // hostile or half-written jsonb cannot reach a consumer.
  //
  // Two of them are additionally shape-checked, and the reason is worth stating.
  // `saveSleeperHandle` is the only code path that writes these, and it resolves
  // the handle on Sleeper first, so every value it writes is one Sleeper itself
  // returned. The DATABASE does not enforce that: `authenticated` holds a column
  // grant on `sleeper_league_settings`, which it needs in order to own its own
  // preferences, so an account owner can PATCH this jsonb directly and put any
  // string in it. `sleeper_user_id` then reaches a URL path segment and
  // `sleeper_avatar` reaches an image URL, so both are validated here, at the
  // one door every read comes through, rather than at each consumer.
  //
  // This is a shape check and NOT an authorization boundary. Nothing in this
  // column may gate access to anything, because its owner can write all of it.
  for (const key of IDENTITY_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      if (key === "sleeper_user_id" && !SLEEPER_USER_ID_PATTERN.test(value)) continue;
      if (key === "sleeper_avatar" && !SLEEPER_AVATAR_ID_PATTERN.test(value)) continue;
      out[key] = value;
    } else if (value === null) {
      out[key] = null;
    }
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

  if (Array.isArray(record.signal_league_ids)) {
    // De-duplicate while preserving the first occurrence's order.
    const seen = new Set<string>();
    out.signal_league_ids = record.signal_league_ids.filter(
      (id): id is string => {
        if (typeof id !== "string" || id.length === 0 || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      },
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
