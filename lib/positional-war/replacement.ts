/**
 * The merged fill and the per-position quantities read off it.
 *
 * Positional WAR reads every number in this module from ONE construction: fill
 * `teamCount` copies of the league's startable slots, optimally, from the whole
 * projectable universe. Run it once per week in the window (the weekly fills)
 * plus once over a bye-free universe built by structuralCandidates() below
 * (the structural fill). That is W + 1 calls per league.
 *
 * THE OPTIMIZER IS NEVER RERUN PER PLAYER. No player is ever removed and the
 * lineup refilled. That is the team-specific metric's job, and
 * lib/faab/marginal.ts already does it correctly. Positional WAR reads its
 * inputs off a single fill and then does arithmetic. Cost is O(W * V * E), not
 * O(P * W * V * E). Seeing buildOptimalLineup in the imports below, the
 * natural instinct is a per-player refill loop, and that loop computes a
 * DIFFERENT metric under the same name (the team-specific "what does losing
 * this player cost" metric, which belongs in Trade Ideas, not here).
 *
 * Ordering invariant this module relies on and the tests assert: because
 * buildOptimalLineup offers candidates in descending points and admits via
 * augmenting paths, and two players at the same position share slot
 * eligibility, the seated players at any one position are exactly the top k
 * of that position by points. So `max(benched at pos) <= min(seated at pos)`
 * always, and `replacement(pos) = max(benched at pos)` is the same quantity as
 * "the (seatedCount + 1)-th best player at that position".
 *
 * REPLACEMENT IS DEFINED PER POSITION (definition A), not per slot (B) and not
 * by rerunning the fill with a player removed (C). B is not comparable across
 * positions: a dedicated RB slot and a FLEX slot in the same league would give
 * RB two different replacement levels and there would be no single number to
 * plot on the RB series. C is the team-specific metric and belongs elsewhere.
 * A also produces the flex-convergence behavior the model wants for free: the
 * merged fill is greedy by points, so the marginal seated player across every
 * flex-eligible position sits near the same points level, and
 * replacement(RB), replacement(WR), and replacement(TE) converge exactly when
 * the league runs deep flex. No positional special case is required.
 */

import { buildOptimalLineup, type LineupCandidate } from "@/lib/power-pulse/lineup";
import { PULSE_POSITIONS, PULSE_SLOT_ELIGIBILITY, type PulsePosition } from "@/lib/power-pulse/types";
import type { WarPlayerInput } from "./types";

/** One merged fill: teamCount copies of a league's slots, optimally filled. */
export type MergedFill = {
  /** null for the structural (bye-free) fill. */
  week: number | null;
  /** Seated players' points, grouped by the position they actually play. */
  seatedByPosition: Map<PulsePosition, number[]>;
  /** Benched players' points, grouped by the position they actually play. */
  benchedByPosition: Map<PulsePosition, number[]>;
  /** League-average optimal lineup total: sum of seated points / teamCount. */
  muRef: number;
  /** League-average optimal lineup spread: sqrt(sum of seated sigma^2 / teamCount). */
  sigmaRef: number;
};

/**
 * Build the merged fill for one week (or the structural universe, when
 * `week` is null) and bucket every seated and benched candidate by position.
 *
 * `slots` is ONE team's startable slot tokens (from `startingSlots()`).
 * `candidates` is the whole projectable universe for this fill, already
 * shaped as `LineupCandidate[]`; for the structural fill, build it with
 * `structuralCandidates()` below.
 */
export function buildMergedFill(params: {
  slots: string[];
  teamCount: number;
  candidates: LineupCandidate[];
  week: number | null;
}): MergedFill {
  const { slots, teamCount, candidates, week } = params;

  const leagueWideSlots = Array.from({ length: teamCount }, () => slots).flat();
  const fill = buildOptimalLineup(leagueWideSlots, candidates);

  // buildOptimalLineup's LineupSlot carries only the seated player's id and
  // points/sigma, not his position, so recover it from the candidate list.
  const positionById = new Map(candidates.map((c) => [c.playerId, c.position]));

  const seatedByPosition = new Map<PulsePosition, number[]>();
  let sumPoints = 0;
  let sumSigmaSq = 0;
  for (const slot of fill.slots) {
    if (slot.playerId === null) continue;
    sumPoints += slot.points;
    sumSigmaSq += slot.sigma * slot.sigma;
    const position = positionById.get(slot.playerId);
    if (!position) continue;
    const bucket = seatedByPosition.get(position);
    if (bucket) bucket.push(slot.points);
    else seatedByPosition.set(position, [slot.points]);
  }

  const benchedByPosition = new Map<PulsePosition, number[]>();
  for (const candidate of fill.benched) {
    const bucket = benchedByPosition.get(candidate.position);
    if (bucket) bucket.push(candidate.points);
    else benchedByPosition.set(candidate.position, [candidate.points]);
  }

  const muRef = teamCount > 0 ? sumPoints / teamCount : 0;
  const sigmaRef = teamCount > 0 ? Math.sqrt(sumSigmaSq / teamCount) : 0;

  return { week, seatedByPosition, benchedByPosition, muRef, sigmaRef };
}

/** Per-position quantities read off one merged fill. */
export type PositionWeekStats = {
  seatedCount: number;
  replacement: number;
  avgSeated: number;
  deficit: number;
  /**
   * True when the projectable pool at this position is thinner than the
   * league starts, so `fill.benched` held nobody at this position and
   * `replacement` fell back to the minimum seated points. Never a fabricated
   * zero: a zero replacement would hand every player at that position an
   * invented edge.
   */
  shallowPool: boolean;
};

/**
 * Read `position`'s stats off `fill`. Returns `seatedCount: 0` (with every
 * other field zeroed) when the position seated nobody, so the caller can drop
 * it from the curve rather than plot a position that never started.
 */
export function positionWeekStats(fill: MergedFill, position: PulsePosition): PositionWeekStats {
  const seated = fill.seatedByPosition.get(position) ?? [];
  const seatedCount = seated.length;

  if (seatedCount === 0) {
    return { seatedCount: 0, replacement: 0, avgSeated: 0, deficit: 0, shallowPool: false };
  }

  const avgSeated = seated.reduce((sum, points) => sum + points, 0) / seatedCount;

  const benched = fill.benchedByPosition.get(position) ?? [];
  const shallowPool = benched.length === 0;
  const replacement = shallowPool ? Math.min(...seated) : Math.max(...benched);

  const deficit = Math.max(0, avgSeated - replacement);

  return { seatedCount, replacement, avgSeated, deficit, shallowPool };
}

/**
 * Which positions this league can start, from its startable slot tokens,
 * deduplicated, in PULSE_POSITIONS order. Mirrors the derivation in
 * lib/faab/free-agents.ts startablePositions(): a league with no K slot gets
 * no K here either. `slots` is expected already-startable (as returned by
 * `startingSlots()`), matching the contract of `buildMergedFill`'s `slots`
 * param.
 */
export function startablePositions(slots: string[]): PulsePosition[] {
  const positions = new Set<PulsePosition>();
  for (const slot of slots) {
    for (const position of PULSE_SLOT_ELIGIBILITY[slot] ?? []) positions.add(position);
  }
  return PULSE_POSITIONS.filter((position) => positions.has(position));
}

/**
 * Represent each player by the arithmetic mean of his points (and of his
 * sigma) across the weeks in `weeks` for which he has a projection. Every
 * player who has at least one such week is present, which is what makes a
 * fill built from this candidate list bye-free: no single week's bye can drop
 * anyone. A player with no projection in any window week is excluded
 * entirely, since he contributes nothing to the fill either way.
 */
export function structuralCandidates(
  players: WarPlayerInput[],
  weeks: number[],
): LineupCandidate[] {
  const candidates: LineupCandidate[] = [];
  for (const player of players) {
    let sumPoints = 0;
    let sumSigma = 0;
    let count = 0;
    for (const week of weeks) {
      const projection = player.byWeek.get(week);
      if (!projection) continue;
      sumPoints += projection.points;
      sumSigma += projection.sigma;
      count += 1;
    }
    if (count === 0) continue;
    candidates.push({
      playerId: player.playerId,
      position: player.position,
      points: sumPoints / count,
      sigma: sumSigma / count,
    });
  }
  return candidates;
}
