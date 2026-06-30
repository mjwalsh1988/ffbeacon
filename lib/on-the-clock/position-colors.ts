/**
 * Position color coding for On The Clock.
 *
 * One distinct hue per positional group (QB/RB/WR/TE/K/DEF), defined as theme
 * colors in tailwind.config.ts (`position.*`). This module is the single source of
 * truth that maps a position to the exact Tailwind class strings used to:
 *   - tint a drafted cell on the board view (POSITION_CELL),
 *   - tint a drafted row on the list view (POSITION_ROW),
 *   - color the position tag in the roster sidebar and roster page (POSITION_BADGE).
 *
 * The class strings are written out in full (no runtime concatenation) so Tailwind's
 * content scanner picks them up. Color is always decorative here: every place that
 * uses it also names the position in text / aria-label, so nothing is color-only.
 *
 * The palette deliberately avoids the reserved brand colors (purple = "your pick",
 * cyan = "on the clock", gold = on-the-clock shine) so a position hue never reads as
 * a draft-state signal.
 */

export type PositionColorKey = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

/** Coerce a raw Sleeper/FF Beacon position string to one of the six color keys. */
export function normalizePositionColor(pos: string | null | undefined): PositionColorKey | null {
  const p = (pos ?? "").toUpperCase();
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K") return p;
  if (p === "DEF" || p === "DST") return "DEF";
  if (p === "PK") return "K";
  return null;
}

/** Tinted background + colored label for a small position tag/pill. */
export const POSITION_BADGE: Record<PositionColorKey, string> = {
  QB: "bg-position-qb/15 text-position-qb",
  RB: "bg-position-rb/15 text-position-rb",
  WR: "bg-position-wr/15 text-position-wr",
  TE: "bg-position-te/15 text-position-te",
  K: "bg-position-k/15 text-position-k",
  DEF: "bg-position-def/15 text-position-def",
};

/** Board view: a clear hue across an entire drafted cell. */
export const POSITION_CELL: Record<PositionColorKey, string> = {
  QB: "bg-position-qb/30",
  RB: "bg-position-rb/30",
  WR: "bg-position-wr/30",
  TE: "bg-position-te/30",
  K: "bg-position-k/30",
  DEF: "bg-position-def/30",
};

/** List view: a faint hint of the position hue behind a drafted row. */
export const POSITION_ROW: Record<PositionColorKey, string> = {
  QB: "bg-position-qb/[0.08]",
  RB: "bg-position-rb/[0.08]",
  WR: "bg-position-wr/[0.08]",
  TE: "bg-position-te/[0.08]",
  K: "bg-position-k/[0.08]",
  DEF: "bg-position-def/[0.08]",
};

/** Neutral fallback classes when a position can't be mapped (e.g. unknown slot). */
export const POSITION_BADGE_FALLBACK = "bg-ink/10 text-ink-muted";
export const POSITION_CELL_FALLBACK = "bg-line-accent/85";
