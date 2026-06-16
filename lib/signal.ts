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
