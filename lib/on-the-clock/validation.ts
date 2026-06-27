/**
 * Reusable, reject-before-fetch input validators for On The Clock.
 *
 * Every value that becomes a Sleeper path segment or an RPC argument is validated
 * here FIRST. The regexes match the security plan (section 12):
 *   username   ^[A-Za-z0-9_]{1,32}$
 *   season     ^[0-9]{4}$
 *   league_id  ^[0-9]{1,20}$
 *   draft_id   ^[0-9]{1,20}$
 * Sleeper player ids are sanitized to ^[A-Za-z0-9]{1,16}$ so numeric player ids
 * AND team-style DST ids ("BUF") both pass, while hostile ids (anything with a
 * dot, space, quote, comma, etc.) are dropped. This keeps the reverse-lookup
 * filter injection-safe even before it reaches PostgREST.
 *
 * These are pure string predicates with no I/O, safe to import anywhere.
 */

const USERNAME_RE = /^[A-Za-z0-9_]{1,32}$/;
const SEASON_RE = /^[0-9]{4}$/;
const SLEEPER_NUMERIC_ID_RE = /^[0-9]{1,20}$/;
const SLEEPER_PLAYER_ID_RE = /^[A-Za-z0-9]{1,16}$/;

export function isValidUsername(value: unknown): value is string {
  return typeof value === "string" && USERNAME_RE.test(value);
}

export function isValidSeason(value: unknown): value is string {
  return typeof value === "string" && SEASON_RE.test(value);
}

export function isValidLeagueId(value: unknown): value is string {
  return typeof value === "string" && SLEEPER_NUMERIC_ID_RE.test(value);
}

export function isValidDraftId(value: unknown): value is string {
  return typeof value === "string" && SLEEPER_NUMERIC_ID_RE.test(value);
}

/**
 * Normalize a username for use as a throttle key (lowercase, trimmed). Returns
 * null when the trimmed value is not a valid username, so callers reject before
 * building a lookup key.
 */
export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isValidUsername(trimmed) ? trimmed.toLowerCase() : null;
}

/**
 * Return the sanitized Sleeper player id, or null if it does not match the
 * allowlist. Numeric player ids and team-code DST ids both pass; everything else
 * (including the Sleeper empty-slot placeholder "0", which is length-1 numeric
 * and DOES match, so callers must strip "0" separately) is the caller's concern.
 */
export function sanitizeSleeperPlayerId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return SLEEPER_PLAYER_ID_RE.test(value) ? value : null;
}

/**
 * Sanitize and de-duplicate a list of Sleeper player ids, dropping any that fail
 * the allowlist. Order-stable on first occurrence. The Sleeper empty-slot
 * placeholder "0" is also dropped here, since it never maps to a real player.
 */
export function sanitizeSleeperPlayerIds(values: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const id = sanitizeSleeperPlayerId(v);
    if (!id || id === "0") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
