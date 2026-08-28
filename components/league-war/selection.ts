/**
 * Deterministic scarcest / flattest position selection.
 *
 * Shared by the rail summary card (E6) and the chart panel's spoken summary
 * sentence, so both surfaces name the same position for the same reason.
 * Pure and side-effect free: same input, same output, every time, which is
 * what acceptance criterion E6-4 requires.
 */

import type { PlottableCurve } from "@/lib/positional-war/types";
import { PULSE_POSITIONS, type PulsePosition } from "@/lib/power-pulse/types";

function positionOrder(curve: PlottableCurve): number {
  return PULSE_POSITIONS.indexOf(curve.position);
}

/** True when a position has a real curve to select from. */
function hasCurve(curve: PlottableCurve): boolean {
  return curve.warRank1 !== null && curve.curve.length > 0;
}

export type ScarcestAndDeepest = {
  scarcest: PlottableCurve | null;
  deepest: PlottableCurve | null;
};

/**
 * scarcest = max war_rank_1, ties broken by min cliff_rank (steeper wins).
 * deepest  = min war_rank_1, ties broken by max cliff_rank (flatter wins).
 *
 * A missing cliff_rank (no cliff found within the plotted depth) sorts as the
 * most extreme possible value for its tiebreak: worst case for "steeper
 * wins" (treated as +Infinity, i.e. never wins a steepness tie) and best case
 * for "flatter wins" (also +Infinity, i.e. no cliff at all is the flattest
 * outcome a position can have).
 *
 * A final tiebreak on position order (QB, RB, WR, TE, K, DEF) guarantees a
 * single deterministic answer even when two positions are identical on both
 * criteria.
 */
export function selectScarcestAndDeepest(curves: readonly PlottableCurve[]): ScarcestAndDeepest {
  const eligible = curves.filter(hasCurve);
  if (eligible.length === 0) return { scarcest: null, deepest: null };

  const scarcest = [...eligible].sort((a, b) => {
    const byWar = (b.warRank1 ?? 0) - (a.warRank1 ?? 0);
    if (byWar !== 0) return byWar;
    const byCliff = (a.cliffRank ?? Infinity) - (b.cliffRank ?? Infinity);
    if (byCliff !== 0) return byCliff;
    return positionOrder(a) - positionOrder(b);
  })[0];

  if (eligible.length < 2) return { scarcest, deepest: null };

  const deepest = [...eligible].sort((a, b) => {
    const byWar = (a.warRank1 ?? 0) - (b.warRank1 ?? 0);
    if (byWar !== 0) return byWar;
    const byCliff = (b.cliffRank ?? Infinity) - (a.cliffRank ?? Infinity);
    if (byCliff !== 0) return byCliff;
    return positionOrder(a) - positionOrder(b);
  })[0];

  // A one-position league (should not happen, must not crash): scarcest and
  // deepest are the same row. Collapse to one line rather than repeat it.
  if (deepest.position === scarcest.position) return { scarcest, deepest: null };

  return { scarcest, deepest };
}

/**
 * The rail card's "Your best X" line, pure so it is testable without a
 * database round trip. Three outcomes, matching section 15.6's edge case
 * table:
 *   - the viewer owns a plotted player at the scarcest position: name him;
 *   - the viewer owns one, but it ranks past the chart's display depth: say
 *     so without a number, because there is no plotted rank to report;
 *   - the viewer resolves no player at the scarcest position at all (no
 *     roster resolved, or genuinely owns nobody there): omit the line.
 */
export function buildYourBestLine(
  scarcestPosition: PulsePosition,
  bestOwned: { positionRank: number; war: number } | null,
  ownsPastDepthAtPosition: boolean,
): string | null {
  if (bestOwned) {
    // "matchups", matching every other user-facing string in this feature
    // (components/league-war/summary.ts). A reader should not meet two units
    // for the same number on two cards of the same page.
    return `Your best ${scarcestPosition} is ${scarcestPosition}${bestOwned.positionRank}, adding ${bestOwned.war.toFixed(2)} matchups.`;
  }
  if (ownsPastDepthAtPosition) {
    return `Your best ${scarcestPosition} ranks past this chart's depth.`;
  }
  return null;
}
