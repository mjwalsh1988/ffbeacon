/**
 * Which defenders a dynasty or keeper roster is never told to cut (plan R-5).
 *
 * The offensive cut list has a guard for exactly this worry: a player still
 * carrying real market value is not offered, because a dynasty cut gives the
 * asset away for good (DYNASTY_KEEP_VALUE in ./advice.ts). No value source
 * prices a defender, so that guard can never fire for one, and without a
 * replacement the cheapest seat on an IDP roster would routinely be a starting
 * linebacker whose projection happens to dip this week.
 *
 * The replacement is the lineup itself. A defender is protected when either
 * holds:
 *
 *   1. The optimiser seats him in at least half of the remaining regular-season
 *      weeks, on the same rest-of-season projections the cut list already
 *      reads, filled with the same slot map the page uses.
 *   2. He ranks inside this roster's starting count at his primary position on
 *      rest-of-season points: a roster that starts one linebacker and an IDP
 *      flex keeps its top two linebackers, whatever a single week says.
 *
 * "The league's IDP starter count" in the plan is read per roster: the number
 * of this team's starting slots his primary can fill. The league-wide reading
 * (rank among every rostered linebacker in the league) would need every other
 * roster projected for the rest of the season inside a page render, and it
 * answers a different question from "would this lineup miss him".
 *
 * Pure. Redraft leagues are not protected here: a redraft cut gives up the rest
 * of one season, and the ordinary cheapest-first ordering is the honest list.
 */

import { buildOptimalLineup, pulseEligibility, type LineupCandidate, type SlotEligibilityMap } from "@/lib/power-pulse/lineup";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { isDefender } from "@/lib/site";

export type ProtectionPlayer = {
  sleeperId: string;
  playerId: string;
  position: PulsePosition;
  eligible?: readonly string[];
};

export type DefenderProtectionInput = {
  isKeeperLeague: boolean;
  /** Startable slot tokens under the map below (lib/power-pulse/lineup.ts startingSlots). */
  slotTokens: readonly string[];
  slotMap: SlotEligibilityMap;
  /** Players who could start: not on injured reserve, not on the taxi squad. */
  roster: readonly ProtectionPlayer[];
  /** Rest-of-season adjusted projections, FF Beacon player id to week to points. */
  pointsByPlayerWeek: ReadonlyMap<string, ReadonlyMap<number, number>>;
  /** The remaining regular-season weeks. */
  weeks: readonly number[];
};

export function protectedDefenderIds(input: DefenderProtectionInput): Set<string> {
  const out = new Set<string>();
  if (!input.isKeeperLeague || input.weeks.length === 0 || input.slotTokens.length === 0) {
    return out;
  }
  const defenders = input.roster.filter((p) => isDefender(p.position));
  if (defenders.length === 0) return out;

  // 1. Seat share across the remaining weeks.
  const seats = new Map<string, number>();
  for (const week of input.weeks) {
    const candidates: LineupCandidate[] = [];
    for (const p of input.roster) {
      const points = input.pointsByPlayerWeek.get(p.playerId)?.get(week);
      if (points === undefined || !Number.isFinite(points)) continue;
      candidates.push({
        playerId: p.playerId,
        position: p.position,
        eligible: pulseEligibility(p.position, p.eligible),
        points,
        sigma: 0,
      });
    }
    if (candidates.length === 0) continue;
    const fill = buildOptimalLineup([...input.slotTokens], candidates, input.slotMap);
    for (const slot of fill.slots) {
      if (slot.playerId) seats.set(slot.playerId, (seats.get(slot.playerId) ?? 0) + 1);
    }
  }
  const half = input.weeks.length / 2;
  for (const p of defenders) {
    if ((seats.get(p.playerId) ?? 0) >= half) out.add(p.sleeperId);
  }

  // 2. Inside the roster's starting count at his primary, on rest-of-season points.
  const slotsFor = new Map<string, number>();
  for (const token of input.slotTokens) {
    for (const position of input.slotMap[token] ?? []) {
      slotsFor.set(position, (slotsFor.get(position) ?? 0) + 1);
    }
  }
  const totalOf = (p: ProtectionPlayer): number => {
    let total = 0;
    for (const points of input.pointsByPlayerWeek.get(p.playerId)?.values() ?? []) total += points;
    return total;
  };
  const byPrimary = new Map<string, ProtectionPlayer[]>();
  for (const p of defenders) {
    const list = byPrimary.get(p.position) ?? [];
    list.push(p);
    byPrimary.set(p.position, list);
  }
  for (const [position, list] of byPrimary) {
    const count = slotsFor.get(position) ?? 0;
    if (count === 0) continue;
    const ranked = list
      .map((p) => ({ p, total: totalOf(p) }))
      .filter((entry) => entry.total > 0)
      .sort((a, b) => b.total - a.total);
    ranked.slice(0, count).forEach((entry) => out.add(entry.p.sleeperId));
  }
  return out;
}
