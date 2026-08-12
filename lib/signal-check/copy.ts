/**
 * Shared reader-facing sentences for Signal Check results.
 *
 * These explain how a traded draft pick was priced, and they are the only thing
 * standing between a reader and the conclusion that two runs of the same trade
 * disagree for no reason. Three surfaces show them (the calculator + Sleeper
 * import, the league feed card, and the share page), so they live here rather
 * than being retyped and quietly drifting apart.
 */

/** A pick whose slot we read off projected standings. */
export const ESTIMATED_PICKS_NOTE =
  "Sleeper does not say where a traded pick will land, so a pick here is slotted from the projected regular season finish of the team it came from: the top third of the standings sends late picks, the middle third mid, the bottom third early. It moves as the projection moves.";

/** A pick we could not slot at all, so it is priced across the whole round. */
export const BLENDED_PICKS_NOTE =
  "A draft pick here has no slot we could pin down, so it is priced between an early and a late pick in that round. That is a wide range, and building the same trade by hand with a specific slot can land on a different verdict.";

/** An asset with no FF Beacon value in this format. */
export const MISSING_VALUES_NOTE =
  "One or more assets had no FF Beacon value, so they were left out of the totals. The verdict is based on the rest.";
