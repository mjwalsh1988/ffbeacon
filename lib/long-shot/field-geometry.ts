/**
 * The field strip's geometry (plan 18A.1). Pure, so the on-page strip and any
 * future image draw the same picture.
 *
 * viewBox 0 0 1000 120. A tier lands at an x: chalk 100, field 300, deep 600,
 * sleeper 850, long_shot 950; a miss or timeout stays behind the line at 40.
 * Markers of one tier spread 36 units apart in prompt order, the group
 * centered on its landing x and kept inside the field.
 */

import { TIER_WORDS, type Tier } from "./types";

export const FIELD_WIDTH = 1000;
export const FIELD_HEIGHT = 120;
export const CENTER_Y = 60;
export const MARKER_R = 16;
export const SPREAD = 36;
export const MISS_X = 40;
/** Half the trail's height at the marker end; the two halves together are 28. */
export const TRAIL_HALF = 14;

const LANDING: Record<Tier, number> = { chalk: 100, field: 300, deep: 600, sleeper: 850, long_shot: 950 };
const MIN_X = MARKER_R + 4;
const MAX_X = FIELD_WIDTH - MARKER_R - 4;

export function landingX(tier: Tier | null): number {
  return tier ? LANDING[tier] : MISS_X;
}

export interface FieldMarker {
  position: number;
  tier: Tier | null;
  /** True for an unanswered prompt (the progress view draws it dim at MISS_X). */
  pending?: boolean;
}

/** x for every marker, keyed by prompt position. */
export function markerPositions(markers: readonly FieldMarker[]): Map<number, number> {
  const groups = new Map<string, FieldMarker[]>();
  for (const m of markers) {
    // Misses and unanswered prompts both sit behind the line, so they share
    // one group there and never overlap each other.
    const key = m.pending || !m.tier ? "line" : m.tier;
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  const out = new Map<number, number>();
  for (const list of groups.values()) {
    const sorted = list.slice().sort((a, b) => a.position - b.position);
    const base = sorted[0].pending || !sorted[0].tier ? MISS_X : landingX(sorted[0].tier);
    const n = sorted.length;
    let xs = sorted.map((_, k) => base + (k - (n - 1) / 2) * SPREAD);
    const lo = xs[0];
    const hi = xs[n - 1];
    if (lo < MIN_X) xs = xs.map((x) => x + (MIN_X - lo));
    else if (hi > MAX_X) xs = xs.map((x) => x - (hi - MAX_X));
    sorted.forEach((m, k) => out.set(m.position, xs[k]));
  }
  // Neighboring groups can still touch (two misses and a Chalk answer meet
  // near x 100), so one sweep keeps every marker a full spread from the next,
  // then a sweep from the right pulls back anything pushed past the field.
  const order = [...out.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (let i = 1; i < order.length; i++) {
    if (order[i][1] - order[i - 1][1] < SPREAD) order[i][1] = order[i - 1][1] + SPREAD;
  }
  if (order.length > 0 && order[order.length - 1][1] > MAX_X) {
    order[order.length - 1][1] = MAX_X;
    for (let i = order.length - 2; i >= 0; i--) {
      if (order[i + 1][1] - order[i][1] < SPREAD) order[i][1] = order[i + 1][1] - SPREAD;
    }
  }
  return new Map(order);
}

/**
 * The kick trail: two closed tapered shapes from the tail (fromX) to the
 * marker (toX), each TRAIL_HALF tall at the marker and 0 at the tail. The
 * upper (primary color) never goes below the center line; the lower
 * (secondary) never goes above it.
 */
export function trailPaths(fromX: number, toX: number, y: number = CENTER_Y): { upper: string; lower: string } {
  const f = Math.round(fromX * 10) / 10;
  const t = Math.round(toX * 10) / 10;
  return {
    upper: `M ${f} ${y} L ${t} ${y - TRAIL_HALF} L ${t} ${y} Z`,
    lower: `M ${f} ${y} L ${t} ${y} L ${t} ${y + TRAIL_HALF} Z`,
  };
}

/** The strip's accessible name: every prompt and the total. */
export function fieldStripLabel(markers: readonly FieldMarker[], total: number): string {
  const parts = markers
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((m) =>
      m.pending ? `prompt ${m.position} not answered yet` : `prompt ${m.position} ${m.tier ? TIER_WORDS[m.tier] : "Miss"}`,
    );
  return `Your answers on the field: ${parts.join(", ")}. Total ${total} points.`;
}
