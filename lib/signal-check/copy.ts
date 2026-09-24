/**
 * Shared reader-facing sentences for Signal Check results.
 *
 * These explain how a traded draft pick was priced, and they are the only thing
 * standing between a reader and the conclusion that two runs of the same trade
 * disagree for no reason. Three surfaces show them (the calculator + Sleeper
 * import, the league feed card, and the share page), so they live here rather
 * than being retyped and quietly drifting apart.
 */

import { partialGradeNote } from "@/lib/trade-grading/partial";

/** A pick whose slot we read off projected standings. */
export const ESTIMATED_PICKS_NOTE =
  "Sleeper does not say where a traded pick will land, so a pick here is slotted from the projected regular season finish of the team it came from: the top third of the standings sends late picks, the middle third mid, the bottom third early. A pick a season beyond the last finish we can project reuses that finish. It moves as the projection moves.";

/** A pick we could not slot at all, so it is priced across the whole round. */
export const BLENDED_PICKS_NOTE =
  "A draft pick here has no slot we could pin down, so it is priced between an early and a late pick in that round. That is a wide range, and building the same trade by hand with a specific slot can land on a different verdict.";

/** An asset with no FF Beacon value in this format. */
export const MISSING_VALUES_NOTE =
  "One or more assets had no FF Beacon value, so they were left out of the totals. The verdict is based on the rest.";

/**
 * The missing-value sentence for a result (plan R-19, IDP-207).
 *
 * A defender is not a missing value: no source prices defenders, and the
 * partial-grade line says exactly that. The generic MISSING_VALUES_NOTE is
 * kept for an asset we expected to price and could not, and fires only when
 * one of those is present too. Returns "" when neither applies.
 */
export function missingValueNote(view: {
  hasMissingValues: boolean;
  partial?: boolean;
  unpricedCount?: number;
  sides: { assets: { noValue: boolean; unpriced?: boolean }[] }[];
}): string {
  const parts: string[] = [];
  if (view.partial) parts.push(partialGradeNote(view.unpricedCount ?? 0));
  const otherMissing = view.sides.some((s) => s.assets.some((a) => a.noValue && !a.unpriced));
  if (view.hasMissingValues && otherMissing) parts.push(MISSING_VALUES_NOTE);
  return parts.join(" ");
}
