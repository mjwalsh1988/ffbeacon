/**
 * The week, graded: what the lineup scored, what the best one available would
 * have scored, whether that gap cost the game, and who was responsible.
 *
 * PURE. Every figure comes from the players and the optimiser result the page
 * is already holding, so this adds no query and no model. It is the report
 * half of the Lineups page, the way lib/league-lineups/simulate.ts is the
 * what-if half.
 *
 * WHERE IT STOPS, AND WHY. This grades ONE WEEK. Anything that spans a season
 * (efficiency rank, wins left on the bench across the year, who is the best
 * manager in the league) belongs to the Manager Ledger and is READ from its
 * cache rather than recomputed here: lib/manager-ledger/ is the model, the
 * Decisions page is its home, and a second implementation of "how good is this
 * manager" would drift from it within a month. See ./season.ts.
 *
 * THE BEST-LINEUP RESULT IS ONE-SIDED, exactly as the Manager Ledger's is. The
 * opponent's score is used as it happened and their bench is left alone,
 * because a reader cannot set their opponent's lineup and "what if we had both
 * been perfect" answers a question nobody is asking.
 *
 * THE DEFICIT IS ADDED TO THE OFFICIAL SCORE rather than the total being
 * rebuilt from parts, which is the same arithmetic lib/manager-ledger/lineup.ts
 * does and for the same reason: the optimiser only improves the slots it can
 * grade, and Sleeper's own total is the number that decided the game.
 */

import type { LineupOptimization, LineupPlayer } from "./types";

/** How a settled week went, against the opponent it was played against. */
export type WeekOutcome = "win" | "loss" | "tie";

/** One player, measured against the number he was projected for. */
export type PlayerSwing = {
  player: LineupPlayer;
  projected: number;
  actual: number;
  /** actual minus projected. */
  diff: number;
};

export type WeekRecap = {
  /** Sleeper's own total for this roster. Null before the week settles. */
  scored: number | null;
  /** The best legal lineup's total, on the same official basis. Null with no optimum. */
  bestPossible: number | null;
  /** bestPossible minus scored, floored at zero. */
  leftOnBench: number | null;
  /** scored over bestPossible, 0 to 1. Null when either is missing. */
  efficiency: number | null;
  /** How the game actually went. Null with no opponent or no result yet. */
  outcome: WeekOutcome | null;
  /** How it would have gone from the best legal lineup. Null alongside `outcome`. */
  bestOutcome: WeekOutcome | null;
  /**
   * True when the game was LOST and the best legal lineup out of the same
   * players would have WON it.
   *
   * The single most useful sentence this page can say about a settled week, and
   * a claim about a real game rather than a modelled quantity. Ties are
   * excluded at both ends, matching the Manager Ledger's `winsLeftOnBench`.
   */
  costTheGame: boolean;
  /** Margin against the opponent, positive for a win. Null with no opponent. */
  margin: number | null;
  /** Starters who beat their projection, biggest first. */
  overperformers: PlayerSwing[];
  /** Starters who missed it, biggest miss first. */
  underperformers: PlayerSwing[];
  /** How many started players beat their projection, out of how many measurable. */
  beatCount: number;
  measuredCount: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function resultOf(points: number, opponentPoints: number | null): WeekOutcome | null {
  if (opponentPoints === null) return null;
  if (points > opponentPoints) return "win";
  if (points < opponentPoints) return "loss";
  return "tie";
}

/**
 * Every started player who can be measured against his own projection.
 *
 * BOTH NUMBERS OR NEITHER. A player with a result and no projection cannot be
 * called an overperformer, and one with a projection and no result did not
 * play. Either way he is left out of the count rather than scored as a zero,
 * which is the same rule the totals on this page follow.
 */
export function playerSwings(groups: { entries: { player: LineupPlayer | null }[] }[]): PlayerSwing[] {
  const out: PlayerSwing[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const entry of group.entries) {
      const player = entry.player;
      if (!player) continue;
      if (seen.has(player.sleeperId)) continue;
      if (player.projected === null || player.actual === null) continue;
      seen.add(player.sleeperId);
      out.push({
        player,
        projected: player.projected,
        actual: player.actual,
        diff: round2(player.actual - player.projected),
      });
    }
  }
  return out;
}

/**
 * Below this, a player did what he was supposed to do.
 *
 * Two points is inside the week-to-week spread of essentially every projection
 * on the page, so calling a 1.4 point beat an overperformance would be reading
 * noise as a finding.
 */
export const SWING_THRESHOLD = 2;

/** How many of a list to name. Beyond this it is a table, not a highlight. */
export const SWING_LIMIT = 3;

export function buildWeekRecap(input: {
  groups: { entries: { player: LineupPlayer | null }[] }[];
  optimization: LineupOptimization;
  /** Sleeper's official total for this roster. Null before the week settles. */
  actualTotal: number | null;
  /** The opponent's official total. Null for a bye, an unpaired roster, or a live week. */
  opponentActual: number | null;
}): WeekRecap {
  const { groups, optimization, actualTotal, opponentActual } = input;

  const leftOnBench = optimization.pointsLeftOnBench;
  const bestPossible =
    actualTotal === null || leftOnBench === null ? null : round2(actualTotal + leftOnBench);

  const outcome = actualTotal === null ? null : resultOf(actualTotal, opponentActual);
  const bestOutcome = bestPossible === null ? null : resultOf(bestPossible, opponentActual);

  const swings = playerSwings(groups);
  const measurable = swings.filter((s) => Math.abs(s.diff) >= SWING_THRESHOLD);

  return {
    scored: actualTotal,
    bestPossible,
    leftOnBench,
    efficiency:
      actualTotal === null || bestPossible === null || bestPossible <= 0
        ? null
        : Math.min(1, Math.round((actualTotal / bestPossible) * 10000) / 10000),
    outcome,
    bestOutcome,
    costTheGame: outcome === "loss" && bestOutcome === "win",
    margin:
      actualTotal === null || opponentActual === null
        ? null
        : round2(actualTotal - opponentActual),
    overperformers: measurable
      .filter((s) => s.diff > 0)
      .sort((a, b) => b.diff - a.diff)
      .slice(0, SWING_LIMIT),
    underperformers: measurable
      .filter((s) => s.diff < 0)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, SWING_LIMIT),
    beatCount: swings.filter((s) => s.diff > 0).length,
    measuredCount: swings.length,
  };
}
