/**
 * One manager's projected finishes, gathered across every league we have synced
 * for them.
 *
 * Pure. Takes the per-league standings the page already loaded and reshapes
 * them; it reads nothing and triggers nothing. A league with no Power Pulse row
 * is not ranked and is reported separately rather than guessed at.
 */

export type ProjectionInput = {
  sleeperLeagueId: string;
  leagueName: string;
  /** 1 for the projected champion. Null when this league has no Power Pulse. */
  projectedSeed: number | null;
  /** Teams the finish is out of. Null alongside a null seed. */
  rankedTeamCount: number | null;
  /** The Contender / Bubble / Rebuilder tag, when we have one. */
  statusLabel: string | null;
};

export type ProjectedLeague = {
  sleeperLeagueId: string;
  leagueName: string;
  projectedSeed: number;
  rankedTeamCount: number;
  statusLabel: string | null;
  /** 0 for first, 1 for last. What the bucket counts below are measured on. */
  percentile: number;
};

export type ProjectionsSummary = {
  /** Ranked leagues, best projected finish first. */
  leagues: ProjectedLeague[];
  /** Leagues in the list we hold no projection for, synced or otherwise. */
  unrankedCount: number;
  first: number;
  second: number;
  third: number;
  /** Ranked leagues in the top third of their league by projected finish. */
  topThird: number;
  /** Ranked leagues in the bottom third. */
  bottomThird: number;
  /** Ranked leagues projected dead last. */
  lastPlace: number;
  /** One line about the shape of it all. Empty when nothing is ranked. */
  anecdote: string;
};

/**
 * Where a finish sits in its own league, 0 for first and 1 for last.
 *
 * Normalising is the only way to compare a 3rd of 14 with a 3rd of 8. A
 * one-team league (which should not exist, but a half-synced league can look
 * like one) is treated as a win rather than a division by zero.
 */
export function finishPercentile(seed: number, teams: number): number {
  if (teams <= 1) return 0;
  return (seed - 1) / (teams - 1);
}

/**
 * Best first.
 *
 * Ordered on the raw seed, because "1st" is the thing a manager is looking for
 * and a normalised score would bury a first-place finish in a small league below
 * a second-place finish in a big one. Ties go to the bigger league: winning a
 * fourteen-team room is a larger claim than winning an eight-team one. Then the
 * name, so the order cannot shuffle between two renders of the same data.
 */
export function compareProjectedLeagues(
  a: ProjectedLeague,
  b: ProjectedLeague,
): number {
  if (a.projectedSeed !== b.projectedSeed)
    return a.projectedSeed - b.projectedSeed;
  if (a.rankedTeamCount !== b.rankedTeamCount) {
    return b.rankedTeamCount - a.rankedTeamCount;
  }
  return a.leagueName.localeCompare(b.leagueName, undefined, {
    sensitivity: "base",
  });
}

/**
 * Narrow the ranked list to a typed query.
 *
 * Name and status tag, because both are how a manager describes a league to
 * themselves: "the Superflex one" and "the ones I am rebuilding" are the same
 * kind of question. The finish itself is deliberately not searchable; "1st" as
 * a substring would also hit "21st" and a manager looking for their best team
 * already has the list sorted that way.
 *
 * Pure, and returns the leagues in the order it was given them, so the
 * best-first sort survives filtering.
 */
export function searchProjectedLeagues(
  leagues: ProjectedLeague[],
  query: string,
): ProjectedLeague[] {
  const q = query.trim().toLowerCase();
  if (!q) return leagues;
  return leagues.filter(
    (league) =>
      league.leagueName.toLowerCase().includes(q) ||
      (league.statusLabel?.toLowerCase().includes(q) ?? false),
  );
}

export function summarizeProjections(
  inputs: ProjectionInput[],
): ProjectionsSummary {
  const leagues: ProjectedLeague[] = [];
  let unrankedCount = 0;

  for (const input of inputs) {
    if (
      input.projectedSeed === null ||
      input.rankedTeamCount === null ||
      input.rankedTeamCount < 1
    ) {
      unrankedCount += 1;
      continue;
    }
    leagues.push({
      sleeperLeagueId: input.sleeperLeagueId,
      leagueName: input.leagueName,
      projectedSeed: input.projectedSeed,
      rankedTeamCount: input.rankedTeamCount,
      statusLabel: input.statusLabel,
      percentile: finishPercentile(input.projectedSeed, input.rankedTeamCount),
    });
  }

  leagues.sort(compareProjectedLeagues);

  const first = leagues.filter((l) => l.projectedSeed === 1).length;
  const second = leagues.filter((l) => l.projectedSeed === 2).length;
  const third = leagues.filter((l) => l.projectedSeed === 3).length;
  const topThird = leagues.filter((l) => l.percentile <= 1 / 3).length;
  const bottomThird = leagues.filter((l) => l.percentile >= 2 / 3).length;
  const lastPlace = leagues.filter(
    (l) => l.projectedSeed === l.rankedTeamCount && l.rankedTeamCount > 1,
  ).length;

  return {
    leagues,
    unrankedCount,
    first,
    second,
    third,
    topThird,
    bottomThird,
    lastPlace,
    anecdote: anecdoteFor({
      total: leagues.length,
      first,
      second,
      third,
      topThird,
      bottomThird,
      lastPlace,
    }),
  };
}

/**
 * The line under the numbers.
 *
 * It is allowed to be funny and it is not allowed to be wrong, so every branch
 * is gated on a threshold the numbers above actually crossed. Checked most
 * specific first, because a manager projected first in most of their leagues
 * also clears the podium test, and the better line is the more specific one.
 *
 * Kept dry rather than loud. A manager reading "your teams are bad" for the
 * fourth week running wants it to land once, not to be shouted at.
 */
function anecdoteFor({
  total,
  first,
  second,
  third,
  topThird,
  bottomThird,
  lastPlace,
}: {
  total: number;
  first: number;
  second: number;
  third: number;
  topThird: number;
  bottomThird: number;
  lastPlace: number;
}): string {
  if (total === 0) return "";

  const podium = first + second + third;
  const share = (n: number) => n / total;

  if (total === 1) {
    const only = 1;
    if (first === only)
      return "Projected to win it. Do not read the schedule too closely.";
    if (bottomThird === only)
      return "One league, and it is not going well. The waiver wire is right there.";
    return "One league in the books. Sync the rest and this page gets more interesting.";
  }

  if (share(first) >= 0.5) {
    return "Projected first in half your leagues or better. That is either a very good offseason or a very soft schedule, and you should enjoy it without asking which.";
  }
  if (share(podium) >= 0.6) {
    return "On the podium almost everywhere. Whatever you did in those drafts, do it again next year.";
  }
  if (share(bottomThird) >= 0.85) {
    return "Nearly every team you own is projected near the bottom. The good news is there is nowhere to go but up. The bad news is you have to sit through it first.";
  }
  if (share(lastPlace) >= 0.4) {
    return "A lot of last-place finishes on this list. Worth checking whether the same three players are dragging all of them down.";
  }
  if (share(bottomThird) >= 0.6) {
    return "Most of your rosters are projected in the bottom third. Usually that is a starting lineup problem before it is a talent problem.";
  }
  if (share(topThird) >= 0.6) {
    return "Top third in most of your leagues. Comfortable, if slightly boring.";
  }
  if (share(topThird) <= 0.2 && share(bottomThird) <= 0.2) {
    return "Almost everything you own is projected mid-table, which is the least useful place to be: too good to sell, not good enough to win.";
  }
  return "A real spread, from contenders to rebuilds. That is what a normal set of leagues looks like.";
}
