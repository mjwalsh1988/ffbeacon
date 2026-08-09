/**
 * Simulate the rest of the draft off Sleeper ADP.
 *
 * Three features need the same answer to "who goes where from here":
 *   - The trade builder, so an unmade pick can be sent to Signal Check as the
 *     player who would actually be taken at that slot rather than as an abstract
 *     asset with no name.
 *   - Team Need, so "take him now" can be justified by what will still be there
 *     at your next pick instead of by an empty roster slot.
 *   - The picks-until-your-turn panel, which lists who is likely gone before you
 *     are back on the clock.
 *
 * ADP, not board value. The old projection walked the board in FF Beacon value
 * order, which answers "who is the best player left" rather than "who will
 * actually be gone". Those differ most exactly where it matters: a player the
 * market loves and we do not will be gone long before his FF Beacon rank says.
 *
 * Players with no ADP still have to be placed, or a thin ADP market would leave
 * the simulation with holes. They are given a synthetic ADP derived from their
 * FF Beacon overall rank so they interleave sensibly, and every pick reports
 * whether the player behind it had real ADP, so the UI can mark the weak ones.
 *
 * Pure and deterministic. No Sleeper, no Supabase, no fetch.
 */

import type { RankedPlayer } from "./board-types";
import type { CurrentDraftPick } from "./pick-ownership";

/** One simulated selection. */
export interface SimulatedPick {
  /** Overall pick number in the current draft. */
  overall: number;
  player: RankedPlayer;
  /** False when the player carried no Sleeper ADP and we placed them by rank. */
  adpKnown: boolean;
}

export interface SimulateInput {
  /** Undrafted, pool-filtered board. */
  available: RankedPlayer[];
  /** Every pick in the current draft, made and unmade, with ownership. */
  currentPicks: CurrentDraftPick[];
  /**
   * Overall pick number on the clock. Picks before it that are somehow still
   * unmade (a paused draft, a gap in the synced picks) are skipped so the
   * simulation always starts at the clock.
   */
  onTheClockPickNo: number;
}

/**
 * Order the available board the way the market would take it. Real ADP first,
 * ascending; players without ADP are slotted by their FF Beacon overall rank,
 * which puts a highly ranked player with no ADP roughly where the market would
 * find him rather than at the very back.
 */
export function orderByAdp(available: RankedPlayer[]): { player: RankedPlayer; adpKnown: boolean }[] {
  return available
    .map((player) => {
      const adp = typeof player.adp === "number" && Number.isFinite(player.adp) && player.adp > 0
        ? player.adp
        : null;
      return {
        player,
        adpKnown: adp !== null,
        // The synthetic key is the overall rank itself. Both scales are "pick
        // number-ish", so mixing them keeps ordinary ordering intact without
        // pretending we measured something we did not.
        key: adp ?? player.overallRank,
      };
    })
    .sort((a, b) => a.key - b.key || a.player.overallRank - b.player.overallRank)
    .map(({ player, adpKnown }) => ({ player, adpKnown }));
}

/**
 * Assign the ADP-ordered board to the remaining picks, in draft order.
 *
 * Returns a map from overall pick number to the player expected there. Picks
 * past the end of the board are absent rather than filled with a placeholder.
 */
export function simulateRemainingDraft(input: SimulateInput): Map<number, SimulatedPick> {
  const { available, currentPicks, onTheClockPickNo } = input;
  const out = new Map<number, SimulatedPick>();

  const start = onTheClockPickNo > 0 ? onTheClockPickNo : 1;
  const remaining = currentPicks
    .filter((p) => !p.made && p.overall >= start)
    .sort((a, b) => a.overall - b.overall);
  if (remaining.length === 0) return out;

  const ordered = orderByAdp(available);
  const limit = Math.min(remaining.length, ordered.length);
  for (let i = 0; i < limit; i += 1) {
    out.set(remaining[i].overall, {
      overall: remaining[i].overall,
      player: ordered[i].player,
      adpKnown: ordered[i].adpKnown,
    });
  }
  return out;
}

/**
 * The next pick a roster owns at or after `fromPickNo`, by CURRENT ownership so
 * a pick traded to you counts and a pick you traded away does not. Null when the
 * roster has none left.
 */
export function nextPickForRoster(
  currentPicks: CurrentDraftPick[],
  rosterId: number | null,
  fromPickNo: number,
): CurrentDraftPick | null {
  if (rosterId === null) return null;
  let best: CurrentDraftPick | null = null;
  for (const p of currentPicks) {
    if (p.made) continue;
    if (p.currentOwnerRosterId !== rosterId) continue;
    if (p.overall < fromPickNo) continue;
    if (!best || p.overall < best.overall) best = p;
  }
  return best;
}

/**
 * Players the simulation expects to be gone strictly before `pickNo`.
 *
 * Used both for the "gone before your next turn" panel and for the Team Need
 * dropoff term, which asks what is still standing when you are next up.
 */
export function goneBefore(
  simulated: Map<number, SimulatedPick>,
  pickNo: number,
): RankedPlayer[] {
  const out: RankedPlayer[] = [];
  for (const [overall, pick] of simulated) {
    if (overall < pickNo) out.push(pick.player);
  }
  return out.sort((a, b) => b.value - a.value);
}

/**
 * The set of player ids expected to survive until `pickNo`, given the current
 * available board. Everything on the board that the simulation does not consume
 * before that pick.
 */
export function survivorsAt(
  available: RankedPlayer[],
  simulated: Map<number, SimulatedPick>,
  pickNo: number,
): RankedPlayer[] {
  const taken = new Set<string>();
  for (const [overall, pick] of simulated) {
    if (overall < pickNo) taken.add(pick.player.playerId);
  }
  return available.filter((p) => !taken.has(p.playerId));
}
