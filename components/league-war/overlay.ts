/**
 * Pure matching logic for the viewer-team overlay (E1a).
 *
 * A player-independent curve becomes more useful once a reader can see where
 * their own roster sits on it. Matching happens entirely off ids already in
 * hand (the curve's WarCurvePoint.sleeperId and rosters.player_ids /
 * reserve_ids / taxi_ids, unioned by lib/league-positional-war-data.ts
 * loadViewerOverlay) so it never reruns the model and never blocks on a
 * roster that has not resolved.
 *
 * Kept out of the chart component and the panel so both the client chart (the
 * ring markers) and the server panel (the "Your best X" lines and the "Yours"
 * table column) match against the exact same rule, and so the rule is
 * testable without rendering anything.
 */

import type { PlottableCurve, WarCurvePoint } from "@/lib/positional-war/types";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { PULSE_POSITIONS } from "@/lib/power-pulse/types";
import type { UnmatchedOwnerInfo } from "@/lib/league-positional-war-data";

export type OwnershipMatch = {
  /** Owned sleeper ids found on each position's curve, best rank first. */
  matchedByPosition: Map<PulsePosition, WarCurvePoint[]>;
  /**
   * Owned ids that appear on no curve entry at all. A curve entry whose own
   * sleeperId is null can never contribute to a match (there is nothing to
   * compare it against), so it is never marked and never removes an id from
   * this list either; it simply never matches anything.
   */
  unmatchedOwnedIds: string[];
};

/**
 * Marks every curve entry whose sleeperId is in the viewer's roster, and
 * reports which owned ids matched nothing anywhere.
 *
 * With an empty owned set (no viewer roster resolved), returns no matches and
 * no unmatched ids, which is what keeps the overlay byte-identical to "no
 * overlay at all" (acceptance criterion E1a-3): there is nothing to add and
 * nothing to report missing.
 */
export function matchCurveOwnership(
  curves: readonly PlottableCurve[],
  ownedSleeperIds: ReadonlySet<string>,
): OwnershipMatch {
  const matchedByPosition = new Map<PulsePosition, WarCurvePoint[]>();
  const foundOwnedIds = new Set<string>();

  if (ownedSleeperIds.size === 0) {
    return { matchedByPosition, unmatchedOwnedIds: [] };
  }

  for (const curve of curves) {
    const marked: WarCurvePoint[] = [];
    for (const point of curve.curve) {
      if (point.sleeperId && ownedSleeperIds.has(point.sleeperId)) {
        marked.push(point);
        foundOwnedIds.add(point.sleeperId);
      }
    }
    if (marked.length > 0) {
      marked.sort((a, b) => a.positionRank - b.positionRank);
      matchedByPosition.set(curve.position, marked);
    }
  }

  const unmatchedOwnedIds = [...ownedSleeperIds].filter((id) => !foundOwnedIds.has(id));
  return { matchedByPosition, unmatchedOwnedIds };
}

export type UnmatchedSplit = {
  /** Rostered, at a plotted position, but ranked past the chart's depth. Named. */
  pastDepth: Array<{ sleeperId: string; name: string; position: PulsePosition }>;
  /** No projection at all, or not a position this chart plots. Counted only. */
  noProjectionCount: number;
};

/**
 * Splits the unmatched owned ids into the two edge cases the panel reports
 * differently: a rostered player at a plotted position (QB/RB/WR/TE/K/DEF)
 * who simply ranks below the stored curve's display-depth cap gets named; a
 * player with no resolvable projection at all (no player record, or a
 * position this chart never plots, such as an IDP slot) is only counted, per
 * section 15.1.1's edge case table. Every id in unmatchedOwnedIds lands in
 * exactly one bucket, so the two counts always add up to the input length.
 */
export function splitUnmatchedOwners(
  unmatchedOwnedIds: readonly string[],
  info: ReadonlyMap<string, UnmatchedOwnerInfo>,
): UnmatchedSplit {
  const pastDepth: Array<{ sleeperId: string; name: string; position: PulsePosition }> = [];
  let noProjectionCount = 0;
  const plottable = new Set<string>(PULSE_POSITIONS);

  for (const id of unmatchedOwnedIds) {
    const entry = info.get(id);
    if (entry && entry.position && plottable.has(entry.position)) {
      pastDepth.push({ sleeperId: id, name: entry.name, position: entry.position as PulsePosition });
    } else {
      noProjectionCount += 1;
    }
  }

  return { pastDepth, noProjectionCount };
}
