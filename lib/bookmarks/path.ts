/**
 * What a bookmark is allowed to point at, and how a raw one is cleaned up.
 *
 * THIS IS A SECURITY BOUNDARY, not a tidying step. The value it returns is
 * rendered straight into an `href`, so anything that could resolve to another
 * origin, or to a scheme other than a page on this site, has to die here. The
 * database repeats the same rules as check constraints (migration 0279),
 * because the belt is worth having even when the braces are tested.
 *
 * WHAT IS REJECTED, AND WHY EACH ONE MATTERS
 *   "https://evil.example"   an absolute URL to somewhere else
 *   "//evil.example"         protocol-relative: a browser resolves this to
 *                            another ORIGIN, and it is the one that gets
 *                            missed, because it starts with a slash
 *   "javascript:alert(1)"    a scheme that executes rather than navigates
 *   "/path\to"               a backslash, which some browsers normalise to "/"
 *                            AFTER a naive check has already passed it
 *   anything with whitespace or a control character, which is how the above
 *                            get smuggled past a check that only looks at the
 *                            start of the string
 *
 * WHAT IS KEPT
 *   The query string, deliberately. A League Pulse tab ("?tab=teams"), a draft
 *   in On The Clock and a shared verdict all live in one, and a bookmark that
 *   dropped it would land the reader on a different page from the one they
 *   pressed save on.
 *
 *   The fragment is dropped. It moves the reader within a page rather than
 *   naming one, and it is not part of what makes two bookmarks the same page.
 *
 * A FULL URL ON THIS ORIGIN IS ACCEPTED and reduced to its path, because the
 * manage page lets a reader paste a link they copied out of the address bar.
 * Everything about that reduction happens here rather than in the form.
 *
 * A LEAGUE PATH IS CANONICALISED. `?username=` and `?name=` describe WHO is
 * looking and what to paint before the league row loads; neither says which
 * page this is. League Pulse already draws the same line for its Copy link
 * button, and for the same reason: a link that carries a handle shows the
 * reader somebody else's team, and a bookmark carrying one would pin that
 * forever, so that two readers who bookmark the same league would be storing
 * two different rows. `?tab=teams` is NOT stripped, because that genuinely is
 * a different page.
 */

import { MAX_BOOKMARK_PATH_LENGTH, MAX_BOOKMARK_LABEL_LENGTH } from "./types";

/**
 * Whitespace, a backslash, or a C0/C1 control character anywhere in the value.
 *
 * The control ranges are written as escapes rather than as literal characters,
 * so that this line survives being copied through an editor or a diff that
 * quietly normalises invisible bytes.
 */
const FORBIDDEN_CHARS = /[\s\\\u0000-\u001f\u007f-\u009f]/;

/**
 * The cleaned path, or null when the input is not a page on this site.
 *
 * `siteOrigins` are the absolute URLs a pasted link may carry. Callers pass the
 * configured site URL; with none given, only relative paths are accepted, which
 * is the safe default rather than a guess about which host we are.
 */
export function normalizeBookmarkPath(
  raw: unknown,
  siteOrigins: readonly string[] = [],
): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (value.length === 0) return null;

  // A pasted absolute URL is reduced to its path, but ONLY when it is this
  // site. Parsing happens before the character check so a URL carrying an
  // encoded space in its query is not thrown out for it.
  if (/^https?:\/\//i.test(value)) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }
    const host = parsed.host.toLowerCase();
    const allowed = siteOrigins.some((origin) => {
      try {
        return new URL(origin).host.toLowerCase() === host;
      } catch {
        return false;
      }
    });
    if (!allowed) return null;
    value = `${parsed.pathname}${parsed.search}`;
  }

  // Drop the fragment. It names a place within a page, not a page.
  const hashAt = value.indexOf("#");
  if (hashAt >= 0) value = value.slice(0, hashAt);
  if (value.length === 0) return null;

  if (FORBIDDEN_CHARS.test(value)) return null;
  if (!value.startsWith("/")) return null;
  // Protocol-relative. Checked after the leading-slash test on purpose: this is
  // the case that looks like a path and is not one.
  if (value.startsWith("//")) return null;
  if (value.length > MAX_BOOKMARK_PATH_LENGTH) return null;

  // "/tools/" and "/tools" are the same page. The root stays "/".
  if (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);

  return canonicaliseLeaguePath(value);
}

/**
 * Query params on a league page that name the VIEWER rather than the page.
 *
 * `username` is the shareable-link mechanism (see the saved-handle rules in
 * CLAUDE.md) and `name` is a first-paint hint the deep view uses for its title
 * before the league row exists. Neither belongs in a bookmark.
 */
const LEAGUE_VIEWER_PARAMS = ["username", "name"];

/**
 * Strip the viewer params from a league path, leaving everything else alone.
 *
 * Applied to every path this module produces, so the string a page compares
 * against and the string that gets stored are the same string by construction.
 * That is what makes the bar able to mark a league page as the current one when
 * the reader arrived on a link carrying a handle.
 */
function canonicaliseLeaguePath(value: string): string {
  const queryAt = value.indexOf("?");
  if (queryAt < 0) return value;
  const pathname = value.slice(0, queryAt);
  if (!pathname.startsWith("/leagues/")) return value;

  const params = new URLSearchParams(value.slice(queryAt + 1));
  for (const name of LEAGUE_VIEWER_PARAMS) params.delete(name);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/**
 * The Sleeper league id a bookmark points at, or null when it is not a league
 * page at all.
 *
 * Used to hang a league's own logo on its bookmark. Digits only, which is what
 * Sleeper issues, so nothing shaped like a traversal or a second path segment
 * can reach the lookup that uses this.
 */
export function sleeperLeagueIdFromPath(path: string): string | null {
  const match = /^\/leagues\/([0-9]{1,32})(?:[/?]|$)/.exec(path);
  return match ? match[1] : null;
}

/**
 * The cleaned label, or null when there is nothing left of it.
 *
 * Runs of whitespace collapse, because a label pasted out of a heading arrives
 * with newlines in it and a bar row is one line tall.
 */
export function normalizeBookmarkLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length === 0) return null;
  return value.slice(0, MAX_BOOKMARK_LABEL_LENGTH);
}

/**
 * The path a reader is currently standing on, in the exact shape a bookmark
 * stores.
 *
 * ONE COPY, because two surfaces compare against it and they disagreed the
 * first time round: the bar built pathname plus query, the mobile sheet
 * compared the pathname alone, so every bookmark saved with a query string
 * (a League Pulse tab, a draft, a shared verdict, the whole reason the query
 * is preserved at all) could never be marked as the current page in the sheet,
 * and every bookmark saved without one was marked current on any page that had
 * params. Both now call this.
 *
 * The fragment is absent for the same reason `normalizeBookmarkPath` drops it.
 */
export function currentBookmarkPath(
  pathname: string,
  query: string | null | undefined,
): string {
  return canonicaliseLeaguePath(query ? `${pathname}?${query}` : pathname);
}
