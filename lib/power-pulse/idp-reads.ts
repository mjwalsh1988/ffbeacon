/**
 * What the IDP switch decides about one league's reads (plan R-12, R-25,
 * IDP-303).
 *
 * Pure, so every League Pulse loader answers the same three questions the same
 * way: which primary positions become lineup candidates, which accuracy and
 * opponent-split keys to read, and which slot map to hand the optimiser.
 *
 * Defenders become candidates only when the switch is on AND the league starts
 * a slot a defender can fill. A league with no defensive slot loads no defender
 * row either way, so switching IDP on cannot change a single read for the 94
 * percent of leagues that do not play it.
 */

import { IDP_POSITIONS, OFFENSE_POSITIONS, isDefender } from "@/lib/site";
import { startingSlots, type SlotEligibilityMap } from "./lineup";
import { slotEligibility } from "./types";

/** Defenders are graded, split and scored on this key and no other. */
export const IDP_SCORING_KEY = "idp123";

export type IdpReads = {
  /** The switch as passed in. */
  idpEnabled: boolean;
  /** True when defenders are candidates in this league. */
  loadsDefenders: boolean;
  /** The slot map the optimiser fills (the OFF map object when the switch is off). */
  slotMap: SlotEligibilityMap;
  /** Primary positions whose players are lineup candidates. */
  candidatePositions: readonly string[];
  /**
   * Accuracy and opponent-split keys, in priority order: the league's own
   * offensive base, plus idp123 when defenders are candidates. The two never
   * collide (no defender row exists under a PPR key, no offensive one under
   * idp123), so the merge in loadAccuracy / loadDefenseSplits is exact.
   */
  scoringKeys: readonly string[];
};

const OFFENSE_CANDIDATES: readonly string[] = OFFENSE_POSITIONS;
const ALL_CANDIDATES: readonly string[] = [...OFFENSE_POSITIONS, ...IDP_POSITIONS];

/** True when this league starts at least one slot a defender can fill under the ON map. */
export function leagueStartsDefenders(rosterPositions: readonly string[]): boolean {
  const on = slotEligibility(true);
  return startingSlots([...rosterPositions], on).some((token) =>
    (on[token] ?? []).some((position) => isDefender(position)),
  );
}

export function idpReadsFor(
  idpEnabled: boolean,
  rosterPositions: readonly string[],
  scoringBase: string,
): IdpReads {
  const loadsDefenders = idpEnabled && leagueStartsDefenders(rosterPositions);
  return {
    idpEnabled,
    loadsDefenders,
    slotMap: slotEligibility(idpEnabled),
    candidatePositions: loadsDefenders ? ALL_CANDIDATES : OFFENSE_CANDIDATES,
    scoringKeys: loadsDefenders ? [scoringBase, IDP_SCORING_KEY] : [scoringBase],
  };
}

/**
 * The scoring key(s) a loader passes to loadAccuracy / loadDefenseSplits.
 * A single string when defenders are not loaded, so the OFF path issues the
 * identical query it always did.
 */
export function scoringKeysArg(reads: IdpReads): string | readonly string[] {
  return reads.loadsDefenders ? reads.scoringKeys : reads.scoringKeys[0];
}
