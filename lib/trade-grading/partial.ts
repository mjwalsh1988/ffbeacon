/**
 * Partial trade grades (plan R-19, IDP-207).
 *
 * No value source prices an individual defensive player. A trade that moves
 * one used to price him at zero and hand down a verdict as though he were
 * worthless, which is a confident answer to a question nobody can answer.
 * Every trade surface now follows one rule, and this is it:
 *
 *   - A defender is named, with "No market value" in words where a number
 *     would go.
 *   - Totals and margin use the priced pieces only.
 *   - The grade is PARTIAL, and says how many defensive players it leaves out.
 *   - When a side has no priced piece at all, there is NO verdict. Comparing
 *     something against nothing is not a grade.
 *
 * UNPRICED and UNRESOLVED are different things and are counted apart. An
 * unpriced player is one we know and no source prices (a linebacker). An
 * unresolved player is an id we could not match to a player at all. The first
 * is a fact about the market; the second is a gap in our data.
 *
 * Pure and client-safe.
 */

import { isDefender } from "@/lib/site";

/** One asset, as much of it as the rule needs. */
export type GradeAsset = {
  /** No value was found for this asset. */
  noValue: boolean;
  /** The player's position, or null for a pick or an unknown player. */
  position: string | null;
  /** False when the id could not be matched to any player. */
  resolved?: boolean;
};

export type PartialGrade = {
  /** At least one defensive player was left out of the totals. */
  partial: boolean;
  /** Defensive players no value source prices. */
  unpricedCount: number;
  /** Ids we could not match to a player. */
  unresolvedCount: number;
  /** False when some side has no priced piece and holds a defender: no verdict. */
  graded: boolean;
};

/** A defender with no value: named, never priced. */
export function isUnpricedDefender(asset: GradeAsset): boolean {
  return asset.noValue && isDefender(asset.position);
}

export function assessPartialGrade(sides: GradeAsset[][]): PartialGrade {
  let unpricedCount = 0;
  let unresolvedCount = 0;
  let graded = true;
  for (const side of sides) {
    let priced = 0;
    let unpriced = 0;
    for (const asset of side) {
      if (asset.resolved === false) unresolvedCount += 1;
      if (isUnpricedDefender(asset)) unpriced += 1;
      else if (!asset.noValue) priced += 1;
    }
    unpricedCount += unpriced;
    if (unpriced > 0 && priced === 0) graded = false;
  }
  return { partial: unpricedCount > 0, unpricedCount, unresolvedCount, graded };
}

/** "Partial grade: excludes 2 defensive players no value source prices." */
export function partialGradeNote(unpricedCount: number): string {
  const who = unpricedCount === 1 ? "1 defensive player" : `${unpricedCount} defensive players`;
  return `Partial grade: excludes ${who} no value source prices.`;
}

/** The verdict line when a side has no priced piece. */
export const NO_VERDICT_LABEL = "No verdict";

/** Why there is no verdict, in one sentence. */
export const NO_VERDICT_REASON =
  "One side of this trade is only defensive players, and no value source prices defensive players, so there is nothing to compare.";
