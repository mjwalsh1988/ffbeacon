/**
 * What does adding this player actually do to your team?
 *
 * The old calculator answered a different question. It took a player's overall
 * rank, divided by "teams times starters", and read a bid off a curve. That
 * prices the player as an asset. A FAAB bid is not an asset purchase: it buys
 * points in YOUR starting lineup over the weeks YOU have left. A dynasty rookie
 * everyone loves can be worth nothing to you this year, and a boring veteran on
 * a good offense can be worth a quarter of your budget.
 *
 * So we do the only thing that actually answers it. Build your optimal lineup
 * for every remaining week without him, build it again with him, and measure
 * the difference. If he never displaces anyone, the difference is zero and we
 * say so out loud instead of quoting a percentage.
 *
 * Pure. Every projection arrives already computed by lib/power-pulse/project.ts,
 * which is the same model the Power Pulse page uses, so a FAAB answer and a
 * Power Pulse answer can never disagree about what a player is projected to do.
 */

import {
  buildOptimalLineup,
  lineupSigma,
  type LineupCandidate,
} from "@/lib/power-pulse/lineup";
import type { PulsePosition } from "@/lib/power-pulse/types";
import type { DropCost, MarginalWeek } from "./types";

/** One week of a candidate's projected output. */
export type CandidateWeek = {
  points: number;
  sigma: number;
  opponent: string | null;
  opponentMultiplier: number;
};

export type LineupSwapInput = {
  /** The league's startable slot tokens, in the league's own order. */
  slots: string[];
  /** Remaining regular season weeks, ascending. */
  weeks: number[];
  /** Your roster's projectable players for each week. */
  rosterByWeek: Map<number, LineupCandidate[]>;
  /** The free agent, projected on identical terms. A missing week is a bye. */
  candidateByWeek: Map<number, CandidateWeek>;
  candidatePlayerId: string;
  candidatePosition: PulsePosition;
  /** Names for whoever we would suggest dropping. */
  rosterMeta: Map<string, { name: string; position: string }>;
  /**
   * True when the roster is full, so adding him requires cutting someone. When
   * there is an open bench spot the drop costs nothing and we do not pretend
   * otherwise.
   */
  mustDrop: boolean;
};

export type LineupSwapResult = {
  weeks: MarginalWeek[];
  weeksConsidered: number;
  weeksStarting: number;
  /** Lineup points he adds, ignoring the cut. Averaged over every week. */
  pointsPerWeek: number;
  /** Averaged over only the weeks he starts. The flattering number. */
  pointsPerStartedWeek: number;
  /** After the cut. This is what the bid is actually built from. */
  netPointsPerWeek: number;
  dropCost: DropCost | null;
  isBenchOnly: boolean;
  /** Weekly lineup mean and spread as your team stands now. */
  weeklyBefore: Map<number, { mean: number; sigma: number }>;
  /** The same, with him added and the cut applied. */
  weeklyAfter: Map<number, { mean: number; sigma: number }>;
};

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function withCandidate(
  roster: LineupCandidate[],
  input: LineupSwapInput,
  week: number,
): LineupCandidate[] {
  const own = input.candidateByWeek.get(week);
  if (!own) return roster;
  return [
    ...roster,
    {
      playerId: input.candidatePlayerId,
      position: input.candidatePosition,
      points: own.points,
      sigma: own.sigma,
    },
  ];
}

/**
 * Which player is cheapest to cut, measured properly.
 *
 * "Worst projected points" is the intuitive answer and the wrong one, because a
 * backup quarterback projected for 14 points may never start while a third
 * running back projected for 9 does. What matters is what the LINEUP loses, so
 * we remove each player in turn, rebuild, and take whoever costs the least.
 * Ties break toward the lower raw projection so the suggestion reads sensibly.
 */
function cheapestDrop(
  input: LineupSwapInput,
  baseTotals: Map<number, number>,
): DropCost | null {
  const { slots, weeks, rosterByWeek, rosterMeta } = input;

  const everyone = new Set<string>();
  for (const week of weeks) {
    for (const c of rosterByWeek.get(week) ?? []) everyone.add(c.playerId);
  }
  if (everyone.size === 0) return null;

  let best: { id: string; cost: number; rawPoints: number } | null = null;

  for (const id of everyone) {
    const costs: number[] = [];
    let rawTotal = 0;
    let rawWeeks = 0;
    for (const week of weeks) {
      const candidates = rosterByWeek.get(week) ?? [];
      const own = candidates.find((c) => c.playerId === id);
      if (own) {
        rawTotal += own.points;
        rawWeeks += 1;
      }
      const without = candidates.filter((c) => c.playerId !== id);
      const reduced = buildOptimalLineup(slots, without).total;
      costs.push(Math.max(0, (baseTotals.get(week) ?? 0) - reduced));
    }
    const cost = meanOf(costs);
    const rawPoints = rawWeeks > 0 ? rawTotal / rawWeeks : 0;
    if (
      best === null ||
      cost < best.cost - 1e-9 ||
      (Math.abs(cost - best.cost) <= 1e-9 && rawPoints < best.rawPoints)
    ) {
      best = { id, cost, rawPoints };
    }
  }

  if (!best) return null;
  const meta = rosterMeta.get(best.id);
  return {
    playerId: best.id,
    name: meta?.name ?? "a bench player",
    position: meta?.position ?? "",
    pointsPerWeek: best.cost,
  };
}

/**
 * Run the swap. Returns the per-week detail plus the weekly distributions for
 * both scenarios, which the caller feeds to the season simulation to turn a
 * points gain into a playoff-odds gain.
 */
export function computeLineupSwap(input: LineupSwapInput): LineupSwapResult {
  const { slots, weeks, rosterByWeek, candidatePlayerId } = input;

  const weeklyBefore = new Map<number, { mean: number; sigma: number }>();
  const weeklyAfter = new Map<number, { mean: number; sigma: number }>();
  const baseTotals = new Map<number, number>();

  // Pass one: the team as it stands. The drop search is measured against these.
  for (const week of weeks) {
    const lineup = buildOptimalLineup(slots, rosterByWeek.get(week) ?? []);
    baseTotals.set(week, lineup.total);
    weeklyBefore.set(week, { mean: lineup.total, sigma: lineupSigma(lineup.slots) });
  }

  // An open bench spot means no cut, and naming one would invent a cost the
  // reader does not actually pay.
  const appliedDrop = input.mustDrop ? cheapestDrop(input, baseTotals) : null;

  const detail: MarginalWeek[] = [];
  const grossGains: number[] = [];
  const netGains: number[] = [];
  const startedGains: number[] = [];

  for (const week of weeks) {
    const base = baseTotals.get(week) ?? 0;
    const roster = rosterByWeek.get(week) ?? [];

    // Gross: what he adds before anything is cut. This is his own contribution.
    const gross = buildOptimalLineup(slots, withCandidate(roster, input, week));

    // Net: the same lineup, after the player you would actually cut is gone.
    // When no cut is required the two are the same build.
    const afterDrop = appliedDrop
      ? buildOptimalLineup(
          slots,
          withCandidate(
            roster.filter((c) => c.playerId !== appliedDrop.playerId),
            input,
            week,
          ),
        )
      : gross;

    weeklyAfter.set(week, {
      mean: afterDrop.total,
      sigma: lineupSigma(afterDrop.slots),
    });

    const startsForYou = afterDrop.slots.some((s) => s.playerId === candidatePlayerId);
    const grossGain = gross.total - base;
    const netGain = afterDrop.total - base;

    grossGains.push(grossGain);
    netGains.push(netGain);
    if (startsForYou) startedGains.push(grossGain);

    const own = input.candidateByWeek.get(week);
    detail.push({
      week,
      startsForYou,
      pointsAdded: netGain,
      opponent: own?.opponent ?? null,
      opponentMultiplier: own?.opponentMultiplier ?? 1,
    });
  }

  const weeksStarting = detail.filter((w) => w.startsForYou).length;

  return {
    weeks: detail,
    weeksConsidered: weeks.length,
    weeksStarting,
    pointsPerWeek: meanOf(grossGains),
    pointsPerStartedWeek: meanOf(startedGains),
    netPointsPerWeek: meanOf(netGains),
    dropCost: appliedDrop,
    isBenchOnly: weeksStarting === 0,
    weeklyBefore,
    weeklyAfter,
  };
}
