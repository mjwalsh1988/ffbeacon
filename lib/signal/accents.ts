// Signal accent palette (Phase 3). Fixed, source-of-truth set of profile
// accents. Every hex below is verified AAA (contrast ratio >= 7:1) as text or
// icon color on the brand-dark background (#0F0F1A), and AAA as a solid FILL
// only when paired with black text (textOnFill = #07070D).
//
// HARD RULE, baked into the helpers below so misuse is impossible:
//   - Accent used as a FILL (buttons, chips, glow cards): text on it is ALWAYS
//     textOnFill (near-black). White text on an accent fill fails AAA badly, so
//     accentFillStyle() returns the locked {backgroundColor, color} pair and
//     call sites never choose their own foreground.
//   - Accent used as TEXT / BORDER / ICON: it sits on the dark background
//     directly via accentInkColor().
//
// The slug set must match the signals.accent CHECK (migration 0069). Server
// actions validate writes against SIGNAL_ACCENT_SLUGS before persisting.

export const SIGNAL_ACCENTS = {
  beacon: { label: "Beacon", hex: "#AD93FB", textOnFill: "#07070D" },
  violet: { label: "Violet", hex: "#C4B5FD", textOnFill: "#07070D" },
  azure: { label: "Azure", hex: "#7DD3FC", textOnFill: "#07070D" },
  cyan: { label: "Cyan", hex: "#5EEAD4", textOnFill: "#07070D" },
  mint: { label: "Mint", hex: "#6EE7B7", textOnFill: "#07070D" },
  lime: { label: "Lime", hex: "#BEF264", textOnFill: "#07070D" },
  amber: { label: "Amber", hex: "#FCD34D", textOnFill: "#07070D" },
  ember: { label: "Ember", hex: "#FDA47A", textOnFill: "#07070D" },
  rose: { label: "Rose", hex: "#FDA4AF", textOnFill: "#07070D" },
  magenta: { label: "Magenta", hex: "#F0ABFC", textOnFill: "#07070D" },
} as const;

export type SignalAccent = keyof typeof SIGNAL_ACCENTS;
export const SIGNAL_ACCENT_SLUGS = Object.keys(SIGNAL_ACCENTS) as SignalAccent[];
export const DEFAULT_ACCENT: SignalAccent = "beacon";

/**
 * Plain-language color name spoken to screen readers (e.g. "Beacon purple").
 * The label alone ("Beacon") does not convey the actual hue, so the picker
 * announces this fuller phrase.
 */
export const ACCENT_SPOKEN_NAME: Record<SignalAccent, string> = {
  beacon: "Beacon purple",
  violet: "Violet",
  azure: "Azure blue",
  cyan: "Cyan",
  mint: "Mint green",
  lime: "Lime green",
  amber: "Amber yellow",
  ember: "Ember orange",
  rose: "Rose pink",
  magenta: "Magenta",
};

export function isSignalAccent(
  slug: string | null | undefined,
): slug is SignalAccent {
  return typeof slug === "string" && slug in SIGNAL_ACCENTS;
}

/** Resolve a stored slug to its accent entry, falling back to the default. */
export function resolveAccent(slug: string | null | undefined) {
  return isSignalAccent(slug) ? SIGNAL_ACCENTS[slug] : SIGNAL_ACCENTS[DEFAULT_ACCENT];
}

/**
 * Accent used as a FILL. Background is the accent hex; foreground is ALWAYS the
 * locked near-black textOnFill. Returning both together makes white-on-accent
 * impossible at the call site.
 */
export function accentFillStyle(slug: string | null | undefined): {
  backgroundColor: string;
  color: string;
} {
  const a = resolveAccent(slug);
  return { backgroundColor: a.hex, color: a.textOnFill };
}

/**
 * Accent used as TEXT / BORDER / ICON on the brand-dark background. Every hex
 * is AAA as ink on #0F0F1A.
 */
export function accentInkColor(slug: string | null | undefined): string {
  return resolveAccent(slug).hex;
}

/**
 * Decorative banner gradient derived from the accent hex (aria-hidden use
 * only). It runs from the accent toward a darkened tone of itself so it always
 * reads as the chosen color.
 */
export function accentGradient(slug: string | null | undefined): string {
  const hex = resolveAccent(slug).hex;
  return `linear-gradient(135deg, ${hex} 0%, ${darkenHex(hex, 0.45)} 100%)`;
}

/** Multiply each RGB channel toward black by `amount` (0..1). Pure + deterministic. */
function darkenHex(hex: string, amount: number): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  const r = Math.round(((n >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((n >> 8) & 0xff) * (1 - amount));
  const b = Math.round((n & 0xff) * (1 - amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
