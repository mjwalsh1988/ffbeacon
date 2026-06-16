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

/** Brand-safe accent options. The slug set matches the signals.accent CHECK.
 * Phase 1 renders the default ('beacon'); the picker lands in a later phase. */
export const ACCENTS: Record<
  string,
  { label: string; from: string; to: string }
> = {
  beacon: { label: "Beacon", from: "#A855F7", to: "#22D3EE" },
  purple: { label: "Purple", from: "#A855F7", to: "#7C3AED" },
  cyan: { label: "Cyan", from: "#22D3EE", to: "#0EA5E9" },
  emerald: { label: "Emerald", from: "#34D399", to: "#10B981" },
  amber: { label: "Amber", from: "#FBBF24", to: "#F59E0B" },
  rose: { label: "Rose", from: "#FB7185", to: "#F43F5E" },
  sky: { label: "Sky", from: "#38BDF8", to: "#0EA5E9" },
  slate: { label: "Slate", from: "#94A3B8", to: "#64748B" },
};

export function accentGradient(slug: string | null | undefined): string {
  const a = ACCENTS[slug ?? "beacon"] ?? ACCENTS.beacon;
  return `linear-gradient(135deg, ${a.from} 0%, ${a.to} 100%)`;
}
