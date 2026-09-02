/**
 * Opponent-adjusting a position's raw allowance, and shrinking the resulting
 * multiplier to the signal that actually persists.
 *
 * WHY THIS EXISTS: raw points allowed carries schedule bias. A defense that
 * happened to face four bad offenses looks generous even if it is not, and a
 * defense that faced four good ones looks stingy even if it is not, because
 * "points allowed" never separates the defense's own quality from the quality
 * of the offenses it lined up against. `calculate-defense-splits.ts` computes
 * the raw allowance; this module removes the schedule's fingerprint from it
 * with the standard alternating-ratings iteration (the same idea behind
 * strength-of-schedule adjustments in other sports): treat each defense's
 * allowance and each offense's output as unknowns, and solve for both at once
 * by repeatedly re-expressing one in terms of the other.
 *
 * WHY THE RESULT IS THEN SHRUNK TOWARD 1.0: an adjusted multiplier is still
 * measured off a handful of games, and matchup effects do not repeat as
 * reliably as raw scoring does. The year over year correlation of the
 * multiplier, position by position, is the honest ceiling on how much of a
 * single-season reading is signal versus noise: DEF 0.319, RB 0.243,
 * TE 0.152, K 0.147, QB 0.107, and WR -0.097, meaning the wide receiver
 * matchup number this season tells you effectively nothing about next
 * season's. A multiplier that ignored this would swing a projection on noise
 * with the same confidence it swings one on signal. `shrinkMultiplier` pulls
 * every adjusted multiplier back toward 1.0 by exactly its measured
 * reliability, and further still when the sample behind it is thin.
 *
 * Pure. Takes plain data, returns plain data, does no I/O and reads no clock,
 * the same contract as lib/positional-war/engine.ts.
 */

/** One game's worth of startable production at one position. */
export type PositionGame = {
  /** Team code of the defense that allowed these points. */
  defense: string;
  /** Team code of the offense that produced them. */
  offense: string;
  week: number;
  /** Sum of the startable performances at this position in that game. */
  points: number;
};

export type TeamRating = {
  team: string;
  /** Mean points per game, unadjusted. */
  rawPerGame: number;
  /** Mean points per game after normalising by the opponent faced. */
  adjustedPerGame: number;
  games: number;
};

export type AdjustedRatings = {
  /** Mean startable points at this position across every game in the input. */
  leagueAverage: number;
  /** Keyed by team code. How generous each defense is. */
  defense: Map<string, TeamRating>;
  /** Keyed by team code. How productive each offense is. */
  offense: Map<string, TeamRating>;
  iterations: number;
};

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function groupBy<T>(items: readonly T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/**
 * Ratios in this module divide by another team's current rating, and that
 * rating can be missing (a team with no games on the other side of the ball
 * in this input), zero, negative, or (after enough degenerate divisions
 * elsewhere) non-finite. Any of those makes the ratio meaningless rather than
 * merely large, so we fall back to the game's raw points instead of an
 * adjusted value. This keeps one bad team from poisoning every other team's
 * rating through a shared denominator; the alternative, letting NaN or
 * Infinity enter a mean, would corrupt that mean and then, on the next
 * iteration, every team that ever faced it.
 */
function usableDivisor(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function seedRatings(games: readonly PositionGame[], byTeam: Map<string, PositionGame[]>): Map<string, number> {
  const seeded = new Map<string, number>();
  for (const [team, teamGames] of byTeam) {
    seeded.set(team, mean(teamGames.map((g) => g.points)));
  }
  return seeded;
}

function toTeamRatings(
  adjusted: Map<string, number>,
  raw: Map<string, number>,
  byTeam: Map<string, PositionGame[]>,
): Map<string, TeamRating> {
  const ratings = new Map<string, TeamRating>();
  for (const [team, rawPerGame] of raw) {
    const adjustedPerGame = adjusted.get(team);
    ratings.set(team, {
      team,
      rawPerGame,
      // A guard above should already keep every value finite; this is the
      // last line of defense so a caller never receives NaN or Infinity.
      adjustedPerGame:
        adjustedPerGame !== undefined && Number.isFinite(adjustedPerGame) ? adjustedPerGame : rawPerGame,
      games: byTeam.get(team)?.length ?? 0,
    });
  }
  return ratings;
}

export function adjustForOpponents(
  games: readonly PositionGame[],
  opts?: { iterations?: number },
): AdjustedRatings {
  const iterations = opts?.iterations ?? 4;

  if (games.length === 0) {
    return { leagueAverage: 0, defense: new Map(), offense: new Map(), iterations: 0 };
  }

  const leagueAverage = mean(games.map((g) => g.points));

  const byDefense = groupBy(games, (g) => g.defense);
  const byOffense = groupBy(games, (g) => g.offense);

  const rawDefense = seedRatings(games, byDefense);
  const rawOffense = seedRatings(games, byOffense);

  // Dividing by a league average that is zero or negative is not an
  // adjustment, it is a crash: every ratio would be zero, undefined, or flip
  // sign for a reason that has nothing to do with schedule strength. There is
  // no meaningful "adjustment" to make in that case, so we hand back the raw
  // ratings untouched, unadjusted, and say so via iterations: 0.
  if (!(leagueAverage > 0)) {
    return {
      leagueAverage: Number.isFinite(leagueAverage) ? leagueAverage : 0,
      defense: toTeamRatings(rawDefense, rawDefense, byDefense),
      offense: toTeamRatings(rawOffense, rawOffense, byOffense),
      iterations: 0,
    };
  }

  let defenseRating = new Map(rawDefense);
  let offenseRating = new Map(rawOffense);

  for (let pass = 0; pass < iterations; pass += 1) {
    // Both halves of a pass read from the values at the START of that half.
    // The new defense map is built entirely from the offense ratings left
    // over from the PREVIOUS pass (or the seed, on pass 0); only once every
    // defense has its new value do we start building the new offense map,
    // and that one reads the defense ratings we just finished, not the ones
    // it started the pass with. Updating either map in place while reading
    // it would let the team processed first leak into the ratings of every
    // team processed after it, in the same pass, which is a different (and
    // wrong) computation from the one the plan specifies.
    const offenseAtPassStart = offenseRating;
    const newDefense = new Map<string, number>();
    for (const [team, teamGames] of byDefense) {
      newDefense.set(
        team,
        mean(
          teamGames.map((g) => {
            const output = offenseAtPassStart.get(g.offense);
            return usableDivisor(output) ? (g.points * leagueAverage) / output : g.points;
          }),
        ),
      );
    }
    defenseRating = newDefense;

    const newOffense = new Map<string, number>();
    for (const [team, teamGames] of byOffense) {
      newOffense.set(
        team,
        mean(
          teamGames.map((g) => {
            const allowance = defenseRating.get(g.defense);
            return usableDivisor(allowance) ? (g.points * leagueAverage) / allowance : g.points;
          }),
        ),
      );
    }
    offenseRating = newOffense;
  }

  return {
    leagueAverage,
    defense: toTeamRatings(defenseRating, rawDefense, byDefense),
    offense: toTeamRatings(offenseRating, rawOffense, byOffense),
    iterations,
  };
}

/**
 * Clamp a ratio into the model's allowed multiplier band.
 *
 * A non-finite input returns `min` rather than propagating. `Math.min(max,
 * Math.max(min, NaN))` is NaN, so without this guard a single degenerate ratio
 * would be written straight into nfl_defense_vs_position.shrunk_multiplier and
 * then multiplied into every projection that faces that defense. Returning the
 * floor is the conservative direction: it says "this matchup is as unhelpful as
 * we allow" rather than silently poisoning the arithmetic downstream.
 */
export function clampMultiplier(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * The multiplier a reader applies: the opponent-adjusted ratio pulled toward
 * 1.0 by how much this position's matchup signal actually persists, and by how
 * many games it was measured over.
 */
export function shrinkMultiplier(params: {
  adjustedMultiplier: number;
  gamesSampled: number;
  /** 0 to 1. This position's measured year-over-year reliability. */
  positionReliability: number;
  /** Empirical Bayes prior strength on the sample size shrink. */
  priorGames: number;
  min: number;
  max: number;
}): number {
  const reliability = clampMultiplier(params.positionReliability, 0, 1);
  const gamesSampled = Math.max(0, params.gamesSampled);
  const priorGames = Math.max(0, params.priorGames);

  // With no games sampled and no prior strength, the sample-size denominator
  // is 0 / 0. There is nothing to shrink toward a sample that does not exist,
  // so the reader gets the neutral multiplier rather than a division error.
  const kSample = gamesSampled + priorGames > 0 ? gamesSampled / (gamesSampled + priorGames) : 0;

  const shrunk = 1 + reliability * kSample * (params.adjustedMultiplier - 1);
  return clampMultiplier(shrunk, params.min, params.max);
}
