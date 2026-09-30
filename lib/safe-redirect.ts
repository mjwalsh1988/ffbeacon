/**
 * The post-sign-in destination, reduced to a path on our own site or nothing.
 *
 * `?next=` on /login, the return cookie on /auth/callback, and anything else
 * that sends a reader somewhere after an auth round trip is caller-supplied
 * input handed to `location.assign` or a `Location` header. A prefix check
 * ("starts with one slash, second character is not a slash") is not enough:
 * browsers strip tab, newline and carriage return from a URL before parsing
 * it, so a slash, a tab and a slash passes the prefix check and then resolves
 * as a protocol-relative URL to another host.
 *
 * So the value is not tidied. It is REJECTED on any control character before
 * anything else looks at it, then RESOLVED against a fixed origin with the
 * WHATWG parser browsers use, and kept only if it is still on that origin and
 * its path does not itself begin with two slashes. Same approach as
 * lib/donate/return-path.ts, with a caller-chosen fallback and the fragment
 * kept.
 *
 * Pure and client-safe: /login calls it in the browser.
 */

/** Any fixed origin works; only "is it still this origin" is asked of it. */
const RESOLVE_BASE = "https://ffbeacon.invalid";

const MAX_LENGTH = 512;

/**
 * True for C0 controls, DEL, and the C1 range. Written as a loop because the
 * characters it looks for cannot be typed into a regex literal in this repo.
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

export function safeRedirectPath(input: unknown, fallback = "/"): string {
  if (typeof input !== "string") return fallback;
  if (input.length === 0 || input.length > MAX_LENGTH) return fallback;
  if (hasControlChars(input)) return fallback;
  // No trim: leading or trailing spaces in a path this site built are a sign
  // the value did not come from this site.
  if (input !== input.trim()) return fallback;

  if (!input.startsWith("/")) return fallback;
  if (input.startsWith("//")) return fallback;
  if (input.includes("\\")) return fallback;

  try {
    const base = new URL(RESOLVE_BASE);
    const resolved = new URL(input, base);
    if (resolved.origin !== base.origin) return fallback;
    const out = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    // `/..//host` normalises to the pathname `//host`, which is live as a
    // protocol-relative URL the moment it is used without an origin in front.
    if (out.startsWith("//") || out.startsWith("/\\")) return fallback;
    return out;
  } catch {
    return fallback;
  }
}
