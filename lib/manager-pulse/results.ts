/**
 * Manager Pulse: results section (docs/manager-pulse/manager-pulse-plan.md 6.2).
 *
 * Pure. No Supabase, no fetch, no clock. Every field on `ManagerResults` is
 * scale-free by construction (a rate, a percentile, a count), so it is safe to
 * pool across dynasty and redraft under the "all" lens per section 6.0. The
 * value-priced figures live in lib/manager-pulse/trading.ts instead, wrapped
 * in `PerTypeStat`, which has no "all" slot at all.
 *
 * WHY FINISH IS A PERCENTILE, NOT A RANK
 *   Third in a 10-team league and third in a 14-team league are different
 *   achievements. `(teamCount - finish) / (teamCount - 1)` maps first place to
 *   1 and last place to 0 regardless of league size, so the two are
 *   comparable and averageable. A league-season with a null `finish`, a null
 *   `teamCount`, or a `teamCount` of 1 (division by zero, and a one-team
 *   league has no real standings) is EXCLUDED from the mean rather than
 *   folded in as a guessed mid-table finish.
 *
 * WHY POINTS FOR AND AGAINST ARE RANKS, NOT TOTALS
 *   Raw point totals mean nothing across leagues with different scoring
 *   settings; a rank within the league-season's own roster count does.
 *   Normalized the same way as finish, 0 (worst) to 1 (best), so all three
 *   percentile-style figures on this card share one reading. A high
 *   points-against rank is BAD LUCK, not achievement: it means the manager's
 *   opponents scored well against them. It is reported for context and is
 *   never framed as something to be proud of.
 *
 * BOTH RANKS COME OUT THE SAME WAY UP, AND THAT COSTS ONE FLIP
 *   The two stored maps both use 1 = the most of their own quantity, because
 *   that is the natural reading of each. But rank 1 on points for is the best
 *   team in the league and rank 1 on points against is the unluckiest, so
 *   `computeRankPercentile` flips the second. Every figure this module returns
 *   runs 0 (worst for this manager) to 1 (best), and a reader is never asked to
 *   remember that one of the two runs backwards.
 *
 * WHY A CHAMPION IS NEVER INFERRED FROM THE BEST RECORD
 *   `championRosterId` is read directly off the league-season and compared to
 *   this manager's `rosterId`. The best regular-season record and the
 *   eventual champion are frequently different rosters once a playoff bracket
 *   is involved, so a league-season with a null `championRosterId` (no
 *   bracket read, or the season has not finished) contributes to neither the
 *   numerator nor the denominator of any rate here, championships included.
 *
 * WHY A TIE COUNTS AS HALF A WIN
 *   This is a choice, not a fact of the schedule, and a reader will wonder
 *   about it. Dropping ties from the denominator would make a manager who
 *   ties every week look identical to one who never played; scoring a tie as
 *   a loss would misname a game nobody lost. Splitting the credit is the
 *   least distorting option, and matches how most league standings break a
 *   tie in points percentage.
 *
 * SAMPLE SIZES, AND WHY THEY ARE NOT ALL THE SAME NUMBER
 *   `sampleSize` is the count of league-seasons in the lens; it is a fact
 *   about how much history exists and is reported at any count above zero.
 *   Every RATE below it (win rate, playoff rate, average finish percentile,
 *   points-for rank) is gated by `minLeagueSeasonsForRate` against its OWN
 *   contributing count, which can be smaller than `sampleSize` when some
 *   league-seasons are missing the bracket or standings data that rate needs.
 *   Below that floor the rate is null. COUNT fields (championships, runner
 *   ups, last-place finishes) are never gated: "1 title in 2 seasons" is a
 *   true statement even though "50% title rate" would mislead, so counts are
 *   always reported once the lens itself is non-empty.
 *
 * WHY AN EMPTY LENS IS NULL, NEVER ZERO
 *   Zero championships out of zero seasons is not a fact about a manager. A
 *   lens with no contributing league-seasons returns null for every field,
 *   `sampleSize` included, rather than a row of zeroes a reader could mistake
 *   for a real, unflattering record.
 */

import { lensForCategory } from "./types";
import type {
  LeagueLens,
  ManagerLeagueRow,
  ManagerRecord,
  ManagerResults,
  PoolableStat,
} from "./types";
import type { ManagerLeagueSeason, ManagerPulseInput } from "./input-types";

const LENSES: LeagueLens[] = ["all", "dynasty", "redraft"];

/** Round to four decimal places. Rates here are shares and percentiles, not raw counts. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function seasonsForLens(
  seasons: ManagerLeagueSeason[],
  lens: LeagueLens,
): ManagerLeagueSeason[] {
  if (lens === "all") return seasons;
  return seasons.filter((s) => lensForCategory(s.category) === lens);
}

function sumRecord(seasons: ManagerLeagueSeason[]): ManagerRecord {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const s of seasons) {
    wins += s.wins;
    losses += s.losses;
    ties += s.ties;
  }
  return { wins, losses, ties };
}

/** A tie counts as half a win. See the file header for why. */
function winRateOf(record: ManagerRecord): number | null {
  const games = record.wins + record.losses + record.ties;
  if (games === 0) return null;
  return round4((record.wins + record.ties * 0.5) / games);
}

function countChampionships(seasons: ManagerLeagueSeason[]): number {
  let count = 0;
  for (const s of seasons) {
    if (
      s.championRosterId !== null &&
      s.rosterId !== null &&
      s.championRosterId === s.rosterId
    ) {
      count += 1;
    }
  }
  return count;
}

function countRunnerUps(seasons: ManagerLeagueSeason[]): number {
  let count = 0;
  for (const s of seasons) {
    if (
      s.runnerUpRosterId !== null &&
      s.rosterId !== null &&
      s.runnerUpRosterId === s.rosterId
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * League-seasons with a null bracket (`playoffRosterIds === null`) are an
 * unknown, not a miss, so they are dropped from the denominator entirely
 * before the floor is checked.
 */
function computePlayoffRate(
  seasons: ManagerLeagueSeason[],
  floor: number,
): number | null {
  const known = seasons.filter((s) => s.playoffRosterIds !== null);
  if (known.length === 0 || known.length < floor) return null;
  const made = known.filter(
    (s) => s.rosterId !== null && s.playoffRosterIds!.includes(s.rosterId),
  ).length;
  return round4(made / known.length);
}

function countLastPlace(seasons: ManagerLeagueSeason[]): number {
  let count = 0;
  for (const s of seasons) {
    if (
      s.finish !== null &&
      s.teamCount !== null &&
      s.teamCount > 1 &&
      s.finish === s.teamCount
    ) {
      count += 1;
    }
  }
  return count;
}

/** Excludes a null finish, a null teamCount, and a one-team league. See file header. */
function computeAvgFinishPercentile(
  seasons: ManagerLeagueSeason[],
  floor: number,
): number | null {
  const usable = seasons.filter(
    (s) => s.finish !== null && s.teamCount !== null && s.teamCount > 1,
  );
  if (usable.length === 0 || usable.length < floor) return null;
  const sum = usable.reduce(
    (acc, s) => acc + (s.teamCount! - s.finish!) / (s.teamCount! - 1),
    0,
  );
  return round4(sum / usable.length);
}

/** Normalized 0 (worst) to 1 (best), same shape as the finish percentile. */
/**
 * Mean normalized rank over the seasons that carry one.
 *
 * Both maps are stored the same way, 1 = the most of their own quantity, which
 * is the natural reading of each: rank 1 for points for is the highest scorer,
 * rank 1 for points against is the roster that conceded the most.
 *
 * Those two mean OPPOSITE things for the manager, and this is where that is
 * reconciled. Every figure this module returns runs 0 (worst for this manager)
 * to 1 (best), so points for is normalized straight and points against is
 * normalized and then flipped. Without the flip the unluckiest manager in the
 * league comes out at 1.0 and the card congratulates them for it, which is the
 * exact bug the test below was written to catch.
 */
function computeRankPercentile(
  seasons: ManagerLeagueSeason[],
  floor: number,
  key: "pointsForRankByRoster" | "pointsAgainstRankByRoster",
): number | null {
  // Rank 1 is good for points for and bad for points against.
  const flip = key === "pointsAgainstRankByRoster";
  const usable = seasons.filter((s) => {
    if (s.rosterId === null || s.teamCount === null || s.teamCount <= 1) return false;
    return s[key][s.rosterId] !== undefined;
  });
  if (usable.length === 0 || usable.length < floor) return null;
  const sum = usable.reduce((acc, s) => {
    const rank = s[key][s.rosterId!];
    const share = (s.teamCount! - rank) / (s.teamCount! - 1);
    return acc + (flip ? 1 - share : share);
  }, 0);
  return round4(sum / usable.length);
}

export function computeResults(input: ManagerPulseInput): ManagerResults {
  const floor = input.settings.samples.minLeagueSeasonsForRate;

  const sampleSize = {} as PoolableStat<number>;
  const record = {} as PoolableStat<ManagerRecord>;
  const winRate = {} as PoolableStat<number>;
  const championships = {} as PoolableStat<number>;
  const runnerUps = {} as PoolableStat<number>;
  const playoffRate = {} as PoolableStat<number>;
  const lastPlaceFinishes = {} as PoolableStat<number>;
  const avgFinishPercentile = {} as PoolableStat<number>;
  const pointsForRank = {} as PoolableStat<number>;
  const pointsAgainstRank = {} as PoolableStat<number>;

  for (const lens of LENSES) {
    const seasons = seasonsForLens(input.leagueSeasons, lens);
    const n = seasons.length;

    if (n === 0) {
      // Zero league-seasons in this lens. Null everywhere, sampleSize
      // included: see "WHY AN EMPTY LENS IS NULL, NEVER ZERO" above.
      sampleSize[lens] = null;
      record[lens] = null;
      winRate[lens] = null;
      championships[lens] = null;
      runnerUps[lens] = null;
      playoffRate[lens] = null;
      lastPlaceFinishes[lens] = null;
      avgFinishPercentile[lens] = null;
      pointsForRank[lens] = null;
      pointsAgainstRank[lens] = null;
      continue;
    }

    const seasonRecord = sumRecord(seasons);

    sampleSize[lens] = n;
    record[lens] = seasonRecord;
    winRate[lens] = n >= floor ? winRateOf(seasonRecord) : null;
    championships[lens] = countChampionships(seasons);
    runnerUps[lens] = countRunnerUps(seasons);
    playoffRate[lens] = computePlayoffRate(seasons, floor);
    lastPlaceFinishes[lens] = countLastPlace(seasons);
    avgFinishPercentile[lens] = computeAvgFinishPercentile(seasons, floor);
    pointsForRank[lens] = computeRankPercentile(seasons, floor, "pointsForRankByRoster");
    pointsAgainstRank[lens] = computeRankPercentile(
      seasons,
      floor,
      "pointsAgainstRankByRoster",
    );
  }

  return {
    sampleSize,
    record,
    winRate,
    championships,
    runnerUps,
    playoffRate,
    lastPlaceFinishes,
    avgFinishPercentile,
    pointsForRank,
    pointsAgainstRank,
  };
}

/**
 * One row per league-season for section 6.8, most recent season first, then
 * by league name. Capped at `settings.display.leagueRowsShown`; a manager
 * with more league-seasons than that simply does not see the older ones in
 * this list; the count of what was found lives on the report container
 * (`ManagerReport.counts`), not on this function.
 */
export function computeLeagueRows(input: ManagerPulseInput): ManagerLeagueRow[] {
  const sorted = [...input.leagueSeasons].sort((a, b) => {
    if (a.season !== b.season) return b.season - a.season;
    return a.leagueName.localeCompare(b.leagueName, undefined, {
      sensitivity: "base",
    });
  });
  const capped = sorted.slice(0, input.settings.display.leagueRowsShown);

  return capped.map((s) => ({
    leagueId: s.leagueId,
    sleeperLeagueId: s.sleeperLeagueId,
    season: s.season,
    leagueName: s.leagueName,
    category: s.category,
    lens: lensForCategory(s.category),
    teamCount: s.teamCount,
    record: { wins: s.wins, losses: s.losses, ties: s.ties },
    finish: s.finish,
    champion:
      s.championRosterId !== null &&
      s.rosterId !== null &&
      s.championRosterId === s.rosterId,
    runnerUp:
      s.runnerUpRosterId !== null &&
      s.rosterId !== null &&
      s.runnerUpRosterId === s.rosterId,
    madePlayoffs:
      s.playoffRosterIds !== null &&
      s.rosterId !== null &&
      s.playoffRosterIds.includes(s.rosterId),
    hasLeaguePulseLink: s.leagueId !== null,
  }));
}
