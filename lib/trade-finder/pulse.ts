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
 * THE MATH, AND WHY IT IS A DERIVATIVE RATHER THAN A SIMULATION
 *   One game is won when your score beats theirs. Modeled as two independent
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
  /**
   * Power Pulse's own season figures for this team, read from its cache.
   *
   * These are the "before" every trade surface prints, so a card and the full
   * evaluation under it start from the same number Power Pulse shows. A trade
   * only ever supplies the change. Null where the cache holds none (a chopped
   * league has no playoff or title odds).
   */
  projectedWins?: number | null;
  playoffOdds?: number | null;
  titleOdds?: number | null;
  /**
   * Chopped leagues only: this week's field, for the survival math below.
   *
   * `own` is this team's expected score and spread for the week, `others` every
   * other team still alive. Null outside a chopped league, or when the week has
   * no projections.
   */
  chopWeek?: ChopWeek | null;
  /** Chopped only: Power Pulse's chance this team is cut this week. */
  chopOdds?: number | null;
};

/** One chopped week's field, from one team's side. */
export type ChopWeek = {
  own: { mean: number; sigma: number };
  others: Array<{ mean: number; sigma: number }>;
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

/**
 * The smallest weekly spread one team is given in the chop math. Same reason
 * as MIN_COMBINED_SIGMA: a zero is Power Pulse having no spread yet, not a team
 * that scores the same every week. Twelve combined over two teams is about
 * 8.5 each.
 */
const MIN_TEAM_SIGMA = 8.5;

/** Grid points across the integral. Enough that the answer is stable to 0.1%. */
const CHOP_GRID = 241;

/**
 * Chance this team posts the lowest score of the week, and so is cut.
 *
 * Every team's score is an independent normal, as the Power Pulse simulation
 * draws it. P(lowest) is the integral over x of this team's density at x times
 * the chance every other team scores above x, worked out on a fixed grid.
 * `shift` moves this team's mean, which is how a trade's lineup change is
 * priced. Null when there is no field to be lowest in.
 */
export function chopProbability(week: ChopWeek, shift = 0): number | null {
  if (week.others.length === 0) return null;
  const mean = week.own.mean + shift;
  if (!Number.isFinite(mean)) return null;
  const sigma = Math.max(Number.isFinite(week.own.sigma) ? week.own.sigma : 0, MIN_TEAM_SIGMA);
  const others = week.others
    .filter((o) => Number.isFinite(o.mean))
    .map((o) => ({
      mean: o.mean,
      sigma: Math.max(Number.isFinite(o.sigma) ? o.sigma : 0, MIN_TEAM_SIGMA),
    }));
  if (others.length === 0) return null;

  const lo = mean - 6 * sigma;
  const hi = mean + 6 * sigma;
  const step = (hi - lo) / (CHOP_GRID - 1);
  let total = 0;
  for (let i = 0; i < CHOP_GRID; i += 1) {
    const x = lo + i * step;
    let aboveAll = 1;
    for (const o of others) aboveAll *= 1 - normalCdf((x - o.mean) / o.sigma);
    const weight = i === 0 || i === CHOP_GRID - 1 ? 0.5 : 1;
    total += weight * (normalDensity((x - mean) / sigma) / sigma) * aboveAll;
  }
  return Math.min(Math.max(total * step, 0), 1);
}

/**
 * What a lineup change does to this week's survival odds in a chopped league,
 * as a change in probability (0.05 is five percentage points).
 *
 * Exact for the shift rather than a slope, because the field is small and the
 * cut is a tail event where a straight line is a poor guess. Null outside a
 * chopped league, or when there is no lineup change to price.
 */
export function survivalDeltaFor(
  lineupDelta: number | null,
  pulse: PulseSnapshot | null | undefined,
): number | null {
  if (lineupDelta === null || !Number.isFinite(lineupDelta)) return null;
  const week = pulse?.chopWeek ?? null;
  if (!week) return null;
  const before = chopProbability(week, 0);
  const after = chopProbability(week, lineupDelta);
  if (before === null || after === null) return null;
  return before - after;
}

/** The standard normal CDF (Abramowitz and Stegun 7.1.26). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z / Math.SQRT2));
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * One chopped team's field for the first remaining week, from the whole
 * league's weekly rows. Null when this team has no row for that week or nobody
 * else does.
 */
export function chopWeekFor(
  rosterId: number,
  weeklyByRoster: ReadonlyMap<number, ReadonlyMap<number, { mean: number; sigma: number }>>,
): ChopWeek | null {
  const own = weeklyByRoster.get(rosterId);
  if (!own || own.size === 0) return null;
  const week = Math.min(...own.keys());
  const mine = own.get(week);
  if (!mine) return null;
  const others: ChopWeek["others"] = [];
  for (const [otherId, byWeek] of weeklyByRoster) {
    if (otherId === rosterId) continue;
    const row = byWeek.get(week);
    if (row) others.push(row);
  }
  return others.length > 0 ? { own: mine, others } : null;
}

/** Below this, a projected-wins change is not worth a sentence. */
export const NAMEABLE_WINS = 0.05;

export const PULSE_LIMITS = { MIN_COMBINED_SIGMA, NAMEABLE_WINS, MIN_TEAM_SIGMA };
