/**
 * What a lineup change is actually worth, in games.
 *
 * Trade Finder measures a deal's effect on the starting lineup in POINTS PER
 * WEEK, which is the right unit for the arithmetic and the wrong one for a
 * decision. Two points a week is a great deal in week 3 and close to nothing in
 * week 16, and it is worth far more against a slate of coin-flips than against a
 * slate a team has already locked up. The reader asking "does this help me" is
 * asking about GAMES, and Power Pulse already holds everything needed to answer
 * that: a mean and a spread for every remaining matchup, on both sides.
 *
 * So this converts. One number per team, `winsPerPoint`: how many extra wins the
 * rest of the season is worth for each additional point per week of expected
 * scoring. Multiply a lineup delta by it and you have a projected-wins delta.
 *
 * THE MATHS, AND WHY IT IS A DERIVATIVE RATHER THAN A SIMULATION
 *   One game is won when your score beats theirs. Modelled as two independent
 *   normals, that is P(win) = Phi(z) with z = (mu_me - mu_them) / s and
 *   s = sqrt(sigma_me^2 + sigma_them^2). Nudge your mean by d and the win
 *   probability moves by phi(z) * d / s to first order, where phi is the normal
 *   density. Summed over the remaining games, that is the change in expected
 *   wins.
 *
 *   The honest alternative is to re-run the Monte Carlo season for every
 *   candidate deal, which is what lib/power-pulse/what-if.ts does for the ONE
 *   trade a reader is looking at. Trade Finder scores several hundred candidate
 *   deals per search; a season simulation each would turn a two second search
 *   into minutes. The derivative costs one number per team, computed once, and
 *   over the range a trade actually moves a lineup (a few points a week) it
 *   tracks the simulation closely because Phi is very nearly straight near the
 *   middle. It is an estimate, it is described as one everywhere it surfaces,
 *   and the builder's full evaluation is one press away for the deal the reader
 *   settles on.
 *
 * NAMING. Nothing here is Positional WAR, which is the player-independent
 * positional metric and owns that token outright (see the naming rule in
 * lib/positional-war/types.ts). This is team-specific, so it is `winsDelta` in
 * code and "projected wins" in copy, exactly like the rest of the team-specific
 * work in lib/power-pulse/what-if.ts and lib/faab/.
 *
 * Pure. No database, no React, no clock.
 */

/** One remaining matchup, from the team's own side. */
export type PulseMatchup = {
  /** Expected points for this team that week. */
  mean: number;
  /** Week-to-week spread for this team. */
  sigma: number;
  /** The opponent's expected points, or null when the week has no opponent. */
  opponentMean: number | null;
  /** The opponent's spread. */
  opponentSigma: number | null;
};

/**
 * What Trade Finder carries about one team's competitive footing.
 *
 * Read from `league_power_pulse_cache` through lib/league-power-pulse-data.ts.
 * Null on a league with no Power Pulse row, which is an absence of an answer
 * rather than an answer of zero, and every consumer treats it that way.
 */
export type PulseSnapshot = {
  /**
   * Extra projected wins per additional point per week of starting lineup, over
   * the games still to play. Null when there is no remaining slate to measure
   * against, which is the honest answer once a season is over.
   */
  winsPerPoint: number | null;
  /**
   * Games still on the schedule.
   *
   * Drives a caveat, never a calculation: a lineup gain in week 15 has two
   * games to show up in, and the projected-wins figure is honest about that
   * without ever saying it out loud.
   */
  remainingGames: number;
};

/** The standard normal density. */
function normalDensity(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * The smallest combined spread this will divide by.
 *
 * A weekly sigma of zero is Power Pulse saying it has no spread for that team
 * yet, not a claim that the team scores the same number every week. Dividing by
 * it would report an infinite sensitivity and hand one week's rounding error
 * the whole ranking, so a floor stands in. Twelve points is about a third of a
 * realistic two-team combined spread: low enough that a genuinely predictable
 * matchup still reads as more sensitive, high enough that it cannot explode.
 */
const MIN_COMBINED_SIGMA = 12;

/**
 * How many extra wins one point a week of lineup is worth over these games.
 *
 * Weeks with no opponent (a bye, or a roster Sleeper left unpaired) are skipped
 * rather than scored against a phantom, because a game that is not played
 * cannot be won.
 */
export function winsPerPoint(weeks: readonly PulseMatchup[]): number | null {
  let total = 0;
  let counted = 0;

  for (const week of weeks) {
    if (week.opponentMean === null) continue;
    if (!Number.isFinite(week.mean) || !Number.isFinite(week.opponentMean)) continue;

    const mySigma = Number.isFinite(week.sigma) ? Math.max(week.sigma, 0) : 0;
    const theirSigma =
      week.opponentSigma !== null && Number.isFinite(week.opponentSigma)
        ? Math.max(week.opponentSigma, 0)
        : 0;
    const combined = Math.max(
      Math.sqrt(mySigma * mySigma + theirSigma * theirSigma),
      MIN_COMBINED_SIGMA,
    );

    const z = (week.mean - week.opponentMean) / combined;
    total += normalDensity(z) / combined;
    counted += 1;
  }

  if (counted === 0) return null;
  return total;
}

/**
 * The projected-wins change a lineup delta buys.
 *
 * Null in, null out, in both directions: a league with no projections has no
 * lineup delta to convert, and a league with no remaining slate has nothing to
 * convert it against. Neither is zero, and reporting zero would tell a reader
 * the trade does not move their season when the truth is that we cannot say.
 */
export function winsDeltaFor(
  lineupDelta: number | null,
  pulse: PulseSnapshot | null | undefined,
): number | null {
  if (lineupDelta === null || !Number.isFinite(lineupDelta)) return null;
  const rate = pulse?.winsPerPoint ?? null;
  if (rate === null || !Number.isFinite(rate)) return null;
  return lineupDelta * rate;
}

/** One team's upcoming week, as Power Pulse stores it. */
export type PulseWeekRow = {
  week: number;
  opponentRosterId: number | null;
  mean: number;
  sigma: number;
};

/**
 * One team's snapshot, from its own weekly rows and the whole league's.
 *
 * The second argument is what makes this awkward enough to be worth its own
 * function: a matchup's sensitivity depends on the OPPONENT's mean and spread
 * as much as on this team's, and Power Pulse stores each team's numbers only
 * on that team's own row. So the caller indexes the league once by roster and
 * week, and this reads the other side of each game out of it.
 *
 * A week whose opponent is missing from the index is dropped rather than
 * scored against a zero, which is the same rule as a week with no opponent at
 * all: a game we cannot see both sides of is a game we cannot say anything
 * about, and a phantom opponent projecting nothing would read as a free win.
 *
 * Pure, so the indexing that feeds it is testable without a database.
 */
export function pulseSnapshotFor(
  weekly: readonly PulseWeekRow[],
  weeklyByRoster: ReadonlyMap<
    number,
    ReadonlyMap<number, { mean: number; sigma: number }>
  >,
): PulseSnapshot {
  const matchups: PulseMatchup[] = [];
  let scheduled = 0;

  for (const week of weekly) {
    const opponent =
      week.opponentRosterId === null
        ? undefined
        : weeklyByRoster.get(week.opponentRosterId)?.get(week.week);
    if (opponent) scheduled += 1;
    matchups.push({
      mean: week.mean,
      sigma: week.sigma,
      opponentMean: opponent?.mean ?? null,
      opponentSigma: opponent?.sigma ?? null,
    });
  }

  return { winsPerPoint: winsPerPoint(matchups), remainingGames: scheduled };
}

/** Below this, a projected-wins change is not worth a sentence. */
export const NAMEABLE_WINS = 0.05;

export const PULSE_LIMITS = { MIN_COMBINED_SIGMA, NAMEABLE_WINS };
