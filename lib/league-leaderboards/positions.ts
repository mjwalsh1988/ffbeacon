/**
 * Which positions a league starts, and how many slots take each one alone.
 * Pure, so the rule is tested without a database.
 */

import { isDefender, IDP_POSITIONS, OFFENSE_POSITIONS } from "@/lib/site";
import { scoresIdp } from "@/lib/league-scoring";
import { slotEligibility } from "@/lib/power-pulse/types";
import { startingSlots } from "@/lib/power-pulse/lineup";
import type { LeaderboardPosition } from "./types";

/** The order positions are listed in, offense first. */
const POSITION_ORDER = [...OFFENSE_POSITIONS, ...IDP_POSITIONS] as readonly LeaderboardPosition[];

/**
 * Which positions this league starts, and how many slots take each one alone.
 *
 * Read off the same slot map the lineup optimizer uses, so a league with no
 * kicker slot has no kicker board and a league starting linebackers has a
 * linebacker board exactly when the rest of League Pulse treats it as one
 * (the IDP switch on, and a scoring rule for defenders). A flex slot names
 * several positions and is deliberately not counted toward any one of them.
 */
export function leaguePositions(
  rosterPositions: readonly string[],
  idpEnabled: boolean,
  scoring: Record<string, number>,
): { positions: LeaderboardPosition[]; dedicatedSlots: Partial<Record<LeaderboardPosition, number>> } {
  const map = slotEligibility(idpEnabled);
  const slots = startingSlots([...rosterPositions], map);
  const started = new Set<string>();
  const dedicatedSlots: Partial<Record<LeaderboardPosition, number>> = {};
  for (const token of slots) {
    const eligible = map[token] ?? [];
    for (const position of eligible) started.add(position);
    if (eligible.length === 1) {
      const only = eligible[0] as LeaderboardPosition;
      dedicatedSlots[only] = (dedicatedSlots[only] ?? 0) + 1;
    }
  }
  const idp = scoresIdp(scoring);
  const positions = POSITION_ORDER.filter((p) => started.has(p) && (!isDefender(p) || idp));
  for (const p of Object.keys(dedicatedSlots) as LeaderboardPosition[]) {
    if (!positions.includes(p)) delete dedicatedSlots[p];
  }
  return { positions, dedicatedSlots };
}
