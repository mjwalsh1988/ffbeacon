// Shared Signal helpers used by both server and client (no server-only imports).
//
// Handle rules mirror the DB CHECK on signals.handle and the lifecycle triggers
// (migrations 0059/0066/0068): 3 to 30 chars, lowercase letters, digits, and
// underscores. Uniqueness, reserved words, reclaim blocking, and rename rate
// limiting are enforced authoritatively in the database; these helpers give the
// UI instant feedback and the server actions a friendly error mapping.

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;
export const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

export const DISPLAY_NAME_MAX = 50;
export const HEADLINE_MAX = 120;
export const BIO_MAX = 2000;

// Wall post limits. These mirror the database backstops on signal_posts:
//   - body CHECK is char_length(body) BETWEEN 1 AND 2000. Postgres char_length
//     counts code points, so POST_BODY_MAX is a CODE POINT cap, not a grapheme
//     cap. Emoji are often several code points (a flag is 2, a ZWJ family is
//     many), so an all-emoji body reaches the limit sooner than the visible
//     glyph count. The composer shows a grapheme-aware counter for readability
//     but gates submit on codePointLength so it never disagrees with the DB.
//   - the BEFORE INSERT/UPDATE trigger rejects more than 3 links, counting
//     occurrences of "http://" or "https://" case-insensitively.
export const POST_BODY_MAX = 2000;
export const POST_LINKS_MAX = 3;

/** Code-point length, matching Postgres char_length (NOT String.prototype.length,
 * which counts UTF-16 code units, and NOT grapheme count). This is the value the
 * 1..2000 body CHECK is evaluated against, so submit gating uses it. */
export function codePointLength(text: string): number {
  return [...text].length;
}

/** Count links the way the signal_posts trigger does: occurrences of an http(s)
 * scheme, case-insensitive. Used for the client-side mirror of the max-3 cap. */
export function countLinks(text: string): number {
  const matches = text.match(/https?:\/\//gi);
  return matches ? matches.length : 0;
}

/** Grapheme count for a human-friendly character counter. Falls back to
 * codePointLength where Intl.Segmenter is unavailable. */
export function graphemeLength(text: string): number {
  const Seg = (
    Intl as unknown as {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "grapheme" },
      ) => { segment: (input: string) => Iterable<unknown> };
    }
  ).Segmenter;
  if (!Seg) return codePointLength(text);
  const segmenter = new Seg(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(text)).length;
}

/** Lowercase + trim so what the user types maps to the canonical stored value. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Returns a human error string for an invalid handle, or null when the format
 * is acceptable. Pure format check only (no availability). */
export function validateHandleFormat(handle: string): string | null {
  if (handle.length < HANDLE_MIN) {
    return `Handle must be at least ${HANDLE_MIN} characters.`;
  }
  if (handle.length > HANDLE_MAX) {
    return `Handle must be ${HANDLE_MAX} characters or fewer.`;
  }
  if (!/^[a-z0-9_]+$/.test(handle)) {
    return "Use only lowercase letters, numbers, and underscores.";
  }
  return null;
}

// The accent palette and its fill/ink/gradient helpers live in
// lib/signal/accents.ts (the Phase 3 fixed set). Re-exported here so existing
// "@/lib/signal" import sites keep working from one canonical source.
export {
  SIGNAL_ACCENTS,
  SIGNAL_ACCENT_SLUGS,
  DEFAULT_ACCENT,
  ACCENT_SPOKEN_NAME,
  isSignalAccent,
  resolveAccent,
  accentFillStyle,
  accentInkColor,
  accentGradient,
  type SignalAccent,
} from "./signal/accents";
