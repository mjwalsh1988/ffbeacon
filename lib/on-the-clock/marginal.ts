/**
 * What does drafting this player actually do for your team?
 *
 * The old Team Need engine scored roster fit with a slot-shaped heuristic:
 * multiply by 1.0 if the position has an open dedicated slot, 0.7 for a flex,
 * 0.25 otherwise. Most leagues start exactly one tight end and it is the slot
 * people fill last, so tight end held the 1.0 long after running back and
 * receiver had spilled to 0.7, the TE-premium multiplier stacked another 1.15 on
 * top, and value could only move the result across a 50-point band. The engine
 * was not broken. It was answering "which position has an unfilled slot" when the
 * question is "which player adds the most to my team".
 *
 * So we answer that one instead, with the same machinery the FAAB calculator
 * uses: build the optimal lineup without him, build it again with him, and
 * measure the difference, every remaining week.
 *
 * THREE THINGS THAT MAKE IT HONEST ONCE THE LINEUP IS FULL
 *
 * 1. Bye weeks are already in it. Every week is simulated separately and a bye is
 *    an ABSENT week rather than a zero, so a backup who starts three times while
 *    your starter is off earns those points here without any special case.
 *
 * 2. Insurance. A player who never cracks the lineup as it stands is still worth
 *    something if the starter ahead of him misses time. We measure it: remove the
 *    best same-position starter, refill, and see what he is worth then. That is
 *    weighted by how available the starter he backs up actually is, from the same
 *    player_projection_accuracy rows Power Pulse reads.
 *
 * 3. Value takes over as the lineup fills. In a start-eleven league the eleventh
 *    starter matters enormously and the twenty-second player barely moves the
 *    lineup at all. Weighting points at a fixed rate would make every late pick
 *    read as "adds nothing", which is useless advice. `pointsWeightFor` decays
 *    the points weight from empty-lineup to full-lineup as the real starting
 *    slots fill, so a full roster is judged on the asset rather than on this
 *    week's lineup, and the recommendation copy says which one it used.
 *
 * Pure. Every projection arrives precomputed from projection-board.ts, so a
 * number here can never disagree with Draft Pulse or with Power Pulse.
 */

import { buildOptimalLineup, type LineupCandidate } from "@/lib/power-pulse/lineup";
import { mean, round } from "@/lib/power-pulse/math";
import type { PulsePosition } from "@/lib/power-pulse/types";
import type { PlayerProjection, ProjectionBoard } from "./projection-board";
import { candidatesForWeek } from "./draft-pulse";
import { weekFor } from "./week-index";

/** One candidate's marginal contribution, in points per week. */
export interface MarginalResult {
  playerId: string;
  /**
   * Mean weekly points added to the optimal starting lineup as the roster stands.
   * Includes upgrades (he displaces a worse starter) and bye coverage.
   */
  startingAdd: number;
  /**
   * Mean weekly points he would add if the best current starter at his position
   * were gone. What he is worth as insurance.
   */
  insuranceAdd: number;
  /**
   * How much better he is than the best player at his position expected to
   * survive to your next pick. The cost of waiting. Zero when nothing is
   * expected to be gone, or when your next pick is unknown.
   */
  dropoffEdge: number;
  /** Weeks out of the remaining slate he is projected to start. */
  weeksStarting: number;
  /** Total weeks considered. */
  weeksConsidered: number;
  /**
   * The single blended points-equivalent the recommender ranks on:
   * startingAdd + insuranceWeight * insuranceAdd + dropoffWeight * dropoffEdge.
   */
  effectiveAdd: number;
  /** Which of the three carried this player, for the reason copy. */
  driver: "starter" | "upgrade" | "scarcity" | "insurance" | "none";
  /** The starter he would displace or back up, when there is one. */
  displaces: { playerId: string; points: number } | null;
}

export interface MarginalSettings {
  /** Credit given to insurance value, 0 to 1. */
  insuranceWeight: number;
  /** Credit given to the cost of waiting, 0 to 1. */
  dropoffWeight: number;
  /**
   * Floor on the injury risk used to weight insurance, so a perfectly available
   * starter still leaves his backup with some credit. Real seasons produce
   * injuries the accuracy table has not seen yet.
   */
  minStarterRisk: number;
}

export const DEFAULT_MARGINAL_SETTINGS: MarginalSettings = {
  insuranceWeight: 0.35,
  dropoffWeight: 0.5,
  minStarterRisk: 0.12,
};

export interface MarginalInput {
  /** The league's startable slot tokens, in the league's own order. */
  slots: string[];
  /** FF Beacon player ids the roster already controls. */
  rosterPlayerIds: string[];
  /** Candidates to price. Capped by the caller. */
  candidateIds: string[];
  /**
   * Player ids expected to still be available at the roster's next pick. Used
   * for the dropoff term. Null when the next pick is unknown, which zeroes it.
   */
  survivorIds: string[] | null;
  board: ProjectionBoard;
  settings: MarginalSettings;
}

export interface MarginalOutput {
  /** Mean weekly points of the optimal lineup as the roster stands. */
  baseline: number;
  /** Mean starting slots actually filled. Drives the fullness blend. */
  startersFilled: number;
  startingSlotCount: number;
  /** 0 to 1. 1 means every starting slot is filled in the average week. */
  fullness: number;
  byPlayer: Record<string, MarginalResult>;
}


/**
 * The roster's best projected starter at a position, by mean points per week.
 * Null when the roster has nobody there.
 */
function bestAtPosition(
  rosterPlayerIds: string[],
  board: ProjectionBoard,
  position: PulsePosition,
): PlayerProjection | null {
  let best: PlayerProjection | null = null;
  for (const id of rosterPlayerIds) {
    const p = board.players[id];
    if (!p || p.position !== position) continue;
    if (!best || p.pointsPerWeek > best.pointsPerWeek) best = p;
  }
  return best;
}

/**
 * The threshold a player of one position must clear to reach the lineup in one
 * week, plus who he pushes out when he does.
 *
 * WHY THIS IS ONE PROBE AND NOT ONE BUILD PER CANDIDATE
 * Choosing a starting lineup is choosing a maximum-weight independent set in a
 * transversal matroid (see lib/power-pulse/lineup.ts). Adding a single element
 * to the ground set either fills a free slot or displaces exactly one incumbent
 * along an augmenting path, so the gain is always `max(0, points - d)` for a
 * threshold `d` that depends on the SLOT STRUCTURE AND THE INCUMBENTS, never on
 * the candidate's own score.
 *
 * So we probe once per (position, week) with an absurdly large score, which is
 * guaranteed to be seated, and read the threshold back off the gain. Every
 * candidate at that position in that week is then arithmetic.
 *
 * This replaced a build per candidate per week: roughly 5,200 optimal-lineup
 * solves per request at 160 candidates, down to about 320.
 */
interface SeatProbe {
  /** Points a player of this position must beat to enter the lineup. */
  threshold: number;
  /** The incumbent who leaves when he does. Null when a slot was free. */
  displacedId: string | null;
}

/**
 * A score no real projection can reach, so the probe is always seated and the
 * subtraction below recovers the threshold exactly.
 */
const PROBE_POINTS = 1e9;

function probeSeat(
  slots: string[],
  roster: LineupCandidate[],
  baseTotal: number,
  baseStarters: Set<string>,
  position: PulsePosition,
): SeatProbe {
  const probed = buildOptimalLineup(slots, [
    ...roster,
    { playerId: PROBE_ID, position, points: PROBE_POINTS, sigma: 0 },
  ]);
  if (!probed.slots.some((s) => s.playerId === PROBE_ID)) {
    // No slot in this league can hold the position at all (a league with no
    // tight end slot and no flex, say). Nothing at this position can ever help,
    // and an unreachable threshold says exactly that.
    return { threshold: Infinity, displacedId: null };
  }
  const threshold = PROBE_POINTS - (probed.total - baseTotal);
  let displacedId: string | null = null;
  const after = new Set(probed.slots.map((s) => s.playerId).filter((id): id is string => id !== null));
  for (const id of baseStarters) {
    if (!after.has(id)) {
      displacedId = id;
      break;
    }
  }
  return { threshold: Math.max(0, threshold), displacedId };
}

const PROBE_ID = "__otc_probe__";

/**
 * Price every candidate.
 *
 * Three passes, none of them per candidate: the roster as it stands, one seat
 * probe per (position, week), and one reduced-roster probe per (position, week)
 * for the insurance term. Everything after that is arithmetic.
 */
export function computeMarginal(input: MarginalInput): MarginalOutput {
  const { slots, rosterPlayerIds, candidateIds, board, settings } = input;
  const weeks = board.weeks;
  const slotCount = slots.length;

  if (slotCount === 0 || weeks.length === 0) {
    return {
      baseline: 0,
      startersFilled: 0,
      startingSlotCount: slotCount,
      fullness: 0,
      byPlayer: {},
    };
  }

  // Pass one: the roster as it stands. Everything is measured against this.
  const baseByWeek = new Map<number, number>();
  const baseStartersByWeek = new Map<number, Set<string>>();
  const rosterByWeek = new Map<number, LineupCandidate[]>();
  const filledCounts: number[] = [];
  for (const week of weeks) {
    const candidates = candidatesForWeek(rosterPlayerIds, board, week);
    rosterByWeek.set(week, candidates);
    const lineup = buildOptimalLineup(slots, candidates);
    baseByWeek.set(week, lineup.total);
    baseStartersByWeek.set(
      week,
      new Set(lineup.slots.map((s) => s.playerId).filter((id): id is string => id !== null)),
    );
    filledCounts.push(lineup.slots.filter((s) => s.playerId !== null).length);
  }
  const baseline = mean([...baseByWeek.values()]);
  const startersFilled = mean(filledCounts);
  const fullness = slotCount > 0 ? Math.min(1, startersFilled / slotCount) : 0;

  const positionsNeeded = new Set<PulsePosition>();
  for (const id of candidateIds) {
    const p = board.players[id];
    if (p) positionsNeeded.add(p.position);
  }

  // Pass two: the seat probe per (position, week).
  const seatByPositionWeek = new Map<string, SeatProbe>();
  for (const position of positionsNeeded) {
    for (const week of weeks) {
      seatByPositionWeek.set(
        `${position}|${week}`,
        probeSeat(
          slots,
          rosterByWeek.get(week) ?? [],
          baseByWeek.get(week) ?? 0,
          baseStartersByWeek.get(week) ?? new Set(),
          position,
        ),
      );
    }
  }

  // Pass three: the same probe against a roster with that position's best
  // starter removed, which is what insurance is worth. Positions with nobody on
  // the roster are skipped: there is no incumbent to insure against, so the
  // reduced lineup IS the base lineup and the answer is already in hand.
  const incumbent = new Map<PulsePosition, PlayerProjection | null>();
  const insuranceByPositionWeek = new Map<string, SeatProbe>();
  for (const position of positionsNeeded) {
    const best = bestAtPosition(rosterPlayerIds, board, position);
    incumbent.set(position, best);
    if (!best) continue;
    const reduced = rosterPlayerIds.filter((id) => id !== best.playerId);
    for (const week of weeks) {
      const candidates = candidatesForWeek(reduced, board, week);
      const lineup = buildOptimalLineup(slots, candidates);
      insuranceByPositionWeek.set(
        `${position}|${week}`,
        probeSeat(
          slots,
          candidates,
          lineup.total,
          new Set(lineup.slots.map((s) => s.playerId).filter((id): id is string => id !== null)),
          position,
        ),
      );
    }
  }

  // Survivor lookup for the dropoff term: the best projected survivor per
  // position, by mean points. Computed once.
  const bestSurvivor = new Map<PulsePosition, number>();
  const survivorPositions = new Set<PulsePosition>();
  if (input.survivorIds) {
    for (const id of input.survivorIds) {
      const p = board.players[id];
      if (!p) continue;
      survivorPositions.add(p.position);
      const current = bestSurvivor.get(p.position);
      if (current === undefined || p.pointsPerWeek > current) {
        bestSurvivor.set(p.position, p.pointsPerWeek);
      }
    }
  }

  const byPlayer: Record<string, MarginalResult> = {};

  for (const candidateId of candidateIds) {
    const projection = board.players[candidateId];
    if (!projection) continue;
    const position = projection.position;

    const gains: number[] = [];
    const insuranceGains: number[] = [];
    let weeksStarting = 0;
    let displacedId: string | null = null;
    let displacedPoints = 0;
    const holder = incumbent.get(position) ?? null;

    for (const week of weeks) {
      const own = weekFor(projection, week);
      if (!own) {
        // His bye. He adds nothing that week, which IS a real zero for him:
        // the lineup is unchanged and the average should feel that.
        gains.push(0);
        insuranceGains.push(0);
        continue;
      }

      const seat = seatByPositionWeek.get(`${position}|${week}`);
      const gain = seat ? Math.max(0, own.points - seat.threshold) : 0;
      gains.push(gain);
      if (gain > 0) {
        weeksStarting += 1;
        const droppedId = seat?.displacedId ?? null;
        if (droppedId) {
          const dropped = board.players[droppedId];
          if (dropped && dropped.pointsPerWeek > displacedPoints) {
            displacedId = droppedId;
            displacedPoints = dropped.pointsPerWeek;
          }
        }
      }

      // With nobody at the position to be insured against, the reduced lineup is
      // the base lineup and the insurance gain is the gain we already have.
      if (!holder) {
        insuranceGains.push(gain);
        continue;
      }
      const insured = insuranceByPositionWeek.get(`${position}|${week}`);
      insuranceGains.push(insured ? Math.max(0, own.points - insured.threshold) : gain);
    }

    const startingAdd = mean(gains);
    const rawInsurance = mean(insuranceGains);
    // Insurance is only the EXTRA a player is worth when the starter is gone,
    // and only in proportion to how likely that is. Counting the whole reduced
    // lineup gain would double count what he already earns as a starter.
    const risk = Math.max(
      settings.minStarterRisk,
      holder?.availability !== null && holder?.availability !== undefined
        ? 1 - holder.availability
        : settings.minStarterRisk,
    );
    const insuranceAdd = Math.max(0, rawInsurance - startingAdd) * risk;

    // The cost of waiting, measured in the same currency: the gap between this
    // player and the best one at his position expected to last until your next
    // turn. A position with NO expected survivor is maximally scarce, not
    // free, so it is charged the player's whole weekly output rather than zero.
    let dropoffEdge = 0;
    if (input.survivorIds) {
      const survivor = bestSurvivor.get(position);
      dropoffEdge =
        survivor === undefined
          ? projection.pointsPerWeek
          : Math.max(0, projection.pointsPerWeek - survivor);
    }

    const effectiveAdd =
      startingAdd +
      settings.insuranceWeight * insuranceAdd +
      settings.dropoffWeight * dropoffEdge;

    let driver: MarginalResult["driver"] = "none";
    if (startingAdd > 0.1 && displacedId === null) driver = "starter";
    else if (startingAdd > 0.1) driver = "upgrade";
    else if (
      settings.dropoffWeight * dropoffEdge > settings.insuranceWeight * insuranceAdd &&
      dropoffEdge > 0.1
    ) {
      driver = "scarcity";
    } else if (insuranceAdd > 0.1) driver = "insurance";

    byPlayer[candidateId] = {
      playerId: candidateId,
      startingAdd: round(startingAdd, 2),
      insuranceAdd: round(insuranceAdd, 2),
      dropoffEdge: round(dropoffEdge, 2),
      weeksStarting,
      weeksConsidered: weeks.length,
      effectiveAdd: round(effectiveAdd, 2),
      driver,
      displaces: displacedId ? { playerId: displacedId, points: round(displacedPoints, 1) } : null,
    };
  }

  return {
    baseline: round(baseline, 1),
    startersFilled: round(startersFilled, 1),
    startingSlotCount: slotCount,
    fullness: round(fullness, 3),
    byPlayer,
  };
}

/**
 * How much of the recommendation should ride on this season's points, given how
 * full the starting lineup already is.
 *
 * An empty lineup is almost entirely a points question: every pick is a starter.
 * A full one is almost entirely an asset question: the next pick is a bench
 * player who will start only on a bye or an injury, and ranking bench players by
 * "points added to a lineup they cannot crack" produces a wall of zeroes and no
 * advice at all. The curve is quadratic in fullness so the handover happens
 * late, around the point where the last starting slot is filled, rather than
 * drifting from the first pick onward.
 *
 * Returns the weight on points; the remainder rides on FF Beacon value.
 */
export function pointsWeightFor(
  fullness: number,
  opts: { empty: number; full: number },
): number {
  const f = Math.min(1, Math.max(0, fullness));
  return opts.empty + (opts.full - opts.empty) * f * f;
}
