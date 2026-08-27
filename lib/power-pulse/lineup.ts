/**
 * Optimal lineup construction against a league's real roster_positions.
 *
 * The trade-value power rankings fill slots greedily and note in a comment that
 * the result "isn't strictly optimal". For Power Pulse the lineup IS the
 * prediction, so an underfilled flex directly corrupts the score.
 *
 * Why plain greedy is not enough: consider a league running WR_TE and
 * WRRB_FLEX, with a 20-point WR, a 15-point TE, and a 12-point RB. Filling
 * slots in order gives the WR to WR_TE and the RB to WRRB_FLEX, for 32. The
 * right answer puts the TE in WR_TE and the WR in WRRB_FLEX, for 35. Slot
 * eligibility in fantasy is nearly nested but not perfectly, and the leagues
 * that break nesting are exactly the ones greedy gets wrong.
 *
 * The algorithm here is exact. A player's projected points do not depend on
 * which slot they occupy, so choosing the starting lineup is choosing a maximum
 * weight independent set in a transversal matroid, and for a matroid, greedy by
 * descending weight is optimal. Each player is offered to the lineup in value
 * order and admitted via an augmenting path (Kuhn's algorithm), which relocates
 * incumbent starters to other slots they are eligible for rather than bumping
 * them out. A player who cannot be admitted without displacing someone more
 * valuable is benched, correctly.
 *
 * The same machinery grades the lineup a manager actually has set, which is
 * where the lineup efficiency rating comes from.
 */

import {
  NON_STARTING_SLOTS,
  PULSE_SLOT_ELIGIBILITY,
  type LineupSlot,
  type PulsePosition,
} from "./types";

/** A candidate for a starting slot in one specific week. */
export type LineupCandidate = {
  playerId: string;
  position: PulsePosition;
  points: number;
  sigma: number;
};

/**
 * Expand a league's roster_positions array into the startable slots, dropping
 * bench, IR, and taxi. Unknown tokens (individual defensive slots in an IDP
 * league) are dropped too: we cannot project them, and filling them with zero
 * would drag every team's projected score toward an unreachable floor.
 */
export function startingSlots(rosterPositions: string[]): string[] {
  const out: string[] = [];
  for (const token of rosterPositions) {
    if (NON_STARTING_SLOTS.has(token)) continue;
    const eligible = PULSE_SLOT_ELIGIBILITY[token];
    if (!eligible || eligible.length === 0) continue;
    out.push(token);
  }
  return out;
}

/** How many startable slots a league runs. Used for depth math. */
export function countStartingSlots(rosterPositions: string[]): number {
  return startingSlots(rosterPositions).length;
}

function eligibleFor(slot: string): PulsePosition[] {
  return PULSE_SLOT_ELIGIBILITY[slot] ?? [];
}

/**
 * Fill every startable slot to maximize total projected points, using each
 * player at most once.
 *
 * Returns the filled slots in the league's own slot order, the total, and the
 * candidates that did not make the lineup so the caller can measure the bench.
 */
export function buildOptimalLineup(
  slots: string[],
  candidates: LineupCandidate[],
): { slots: LineupSlot[]; total: number; benched: LineupCandidate[] } {
  const slotEligibility = slots.map((slot) => eligibleFor(slot));
  /** slot index to the candidate currently holding it. */
  const occupant: (LineupCandidate | null)[] = slots.map(() => null);

  /**
   * Slot indices a position can occupy, ascending, precomputed once per fill.
   *
   * Eligibility depends on the candidate's POSITION and nothing else, so the
   * answer is the same for every candidate at that position and for every one
   * of the (many) times an augmenting path re-asks it about an incumbent. The
   * previous shape rebuilt the array on each ask, scanning every slot and
   * running Array.includes over its eligibility list, which is the single
   * hottest thing in a Positional WAR compute: that fill offers 613 candidates
   * to 120 merged slots, fourteen times over, and each offer walks a
   * relocation chain. Same indices, same ascending order, so the seating
   * decisions are byte-identical; only the repeated scanning is gone.
   */
  const slotsByPosition = new Map<PulsePosition, number[]>();
  for (let i = 0; i < slotEligibility.length; i += 1) {
    for (const position of slotEligibility[i]) {
      const bucket = slotsByPosition.get(position);
      if (bucket) bucket.push(i);
      else slotsByPosition.set(position, [i]);
    }
  }
  const NO_SLOTS: number[] = [];

  /**
   * Which attempt last visited each slot. A plain stamp array replaces the
   * per-candidate Set<number>: one allocation for the whole fill instead of
   * one per offer, and an integer compare instead of a hash lookup. Attempt
   * numbering starts at 1 so the zero-filled initial state means "unvisited".
   */
  const visitedStamp = new Int32Array(slots.length);
  let attempt = 0;

  /**
   * Try to seat `candidate`, relocating incumbents along an augmenting path.
   * The stamp guards against revisiting a slot within one attempt.
   */
  const seat = (candidate: LineupCandidate): boolean => {
    const eligibleSlots = slotsByPosition.get(candidate.position) ?? NO_SLOTS;
    for (const slotIndex of eligibleSlots) {
      if (visitedStamp[slotIndex] === attempt) continue;
      visitedStamp[slotIndex] = attempt;
      const current = occupant[slotIndex];
      if (current === null || seat(current)) {
        occupant[slotIndex] = candidate;
        return true;
      }
    }
    return false;
  };

  // Descending points. Greedy in this order is optimal on a transversal matroid.
  const ordered = [...candidates].sort((a, b) => b.points - a.points);
  const seated = new Set<string>();
  for (const candidate of ordered) {
    attempt += 1;
    if (seat(candidate)) seated.add(candidate.playerId);
  }

  const filled: LineupSlot[] = [];
  let total = 0;
  for (let i = 0; i < slots.length; i += 1) {
    const holder = occupant[i];
    total += holder?.points ?? 0;
    filled.push({
      slot: slots[i],
      eligible: slotEligibility[i],
      playerId: holder?.playerId ?? null,
      points: holder?.points ?? 0,
      sigma: holder?.sigma ?? 0,
    });
  }

  const benched = candidates.filter((c) => !seated.has(c.playerId));
  return { slots: filled, total, benched };
}

/**
 * Score the lineup a manager currently has set. Sleeper returns starters as an
 * array aligned to roster_positions, so a player who is on bye or has no
 * projection simply contributes nothing, which is what happens in the real game.
 *
 * Returns null when there is no set lineup to grade, so lineup efficiency stays
 * null rather than reporting a misleading zero.
 */
export function scoreSetLineup(
  setStarterIds: string[],
  candidates: LineupCandidate[],
): { total: number; sigma: number } | null {
  if (setStarterIds.length === 0) return null;
  const byId = new Map(candidates.map((c) => [c.playerId, c]));
  let total = 0;
  let variance = 0;
  let matched = 0;
  const counted = new Set<string>();
  for (const id of setStarterIds) {
    if (counted.has(id)) continue;
    counted.add(id);
    const candidate = byId.get(id);
    if (!candidate) continue;
    matched += 1;
    total += candidate.points;
    variance += candidate.sigma * candidate.sigma;
  }
  if (matched === 0) return null;
  return { total, sigma: Math.sqrt(variance) };
}

/**
 * Combined standard deviation for a set of slots. Player-to-player independence
 * is assumed, so variances add. Same simplification as winProbability.
 */
export function lineupSigma(slots: LineupSlot[]): number {
  let variance = 0;
  for (const slot of slots) variance += slot.sigma * slot.sigma;
  return Math.sqrt(variance);
}
