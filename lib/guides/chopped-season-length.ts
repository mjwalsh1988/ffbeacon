/**
 * How long a chopped league lasts, and why every platform picked the team
 * count it picked.
 *
 * EXACT ARITHMETIC, NOT A SIMULATION. One roster leaves the league every week,
 * so a league of N teams has N minus 1 chops in it and the last one lands in
 * week N minus 1. That single subtraction decides the whole shape of the
 * season, and it is the reason the published team counts look arbitrary and
 * are not:
 *
 *   Sleeper recommends 18            last chop week 17, one survivor
 *   Yahoo public death leagues 14    last chop week 13, which is exactly the
 *                                    13-week season Yahoo advertises
 *   FFPC Chop Classic 18             last chop week 17
 *   NFFC Eliminator 17               stops chopping at week 13 on purpose,
 *                                    leaving four for a total-points final
 *   ESPN's own 20-team example       two teams still alive after week 18, and
 *                                    the higher score that week takes it
 *
 * Every one of those falls out of the subtraction. A league cannot chop its
 * way to a single winner unless it starts with 19 teams or fewer, because
 * there are only 18 NFL weeks to do it in, and a league that starts with fewer
 * than 19 finishes before the season does.
 *
 * NOTHING HERE IS A RECOMMENDATION. It reports what a team count implies. The
 * guide says in words which platforms chose which, and why an early finish is
 * a real cost rather than a rounding error.
 *
 * Pure: no clock, no client, no I/O.
 */

/**
 * The last week of the NFL regular season, which is the last week a chopped
 * league can score. Every format in the guide's table stops here or earlier.
 */
export const NFL_LAST_WEEK = 18;

export type SeasonLength = {
  teams: number;
  /** Chops needed to leave one team standing. */
  chopsToOneLeft: number;
  /**
   * The week the last chop lands, when the league can finish inside the NFL
   * season. Null when it cannot.
   */
  lastChopWeek: number | null;
  /** Teams still alive after week 18 when the league cannot finish. */
  survivorsAtSeasonEnd: number;
  /** NFL weeks the league does not use. 0 when it runs to the end or beyond. */
  unusedWeeks: number;
  /** Which of the three shapes this league has. */
  shape: "finishes-early" | "finishes-exactly" | "needs-a-decider";
};

/**
 * What a team count implies, for any count a real platform permits.
 *
 * Counts below 2 are meaningless (a league of one has nobody to chop) and are
 * clamped rather than thrown on, because this is called from a control whose
 * options are fixed and from a test that walks a range.
 */
export function seasonLengthFor(teams: number): SeasonLength {
  const n = Math.max(2, Math.floor(teams));
  const chopsToOneLeft = n - 1;

  if (chopsToOneLeft > NFL_LAST_WEEK) {
    // More teams than the season has weeks to remove them. Chopping one a week
    // cannot reach a single survivor, so the league needs a rule that is not
    // chopping: ESPN decides its 20-team example on the final week's score,
    // and the NFFC switches to a total-points final.
    return {
      teams: n,
      chopsToOneLeft,
      lastChopWeek: null,
      survivorsAtSeasonEnd: n - NFL_LAST_WEEK,
      unusedWeeks: 0,
      shape: "needs-a-decider",
    };
  }

  return {
    teams: n,
    chopsToOneLeft,
    lastChopWeek: chopsToOneLeft,
    survivorsAtSeasonEnd: 1,
    unusedWeeks: NFL_LAST_WEEK - chopsToOneLeft,
    shape: chopsToOneLeft === NFL_LAST_WEEK ? "finishes-exactly" : "finishes-early",
  };
}

/** A real format that uses this team count, for the control to name. */
export type KnownCount = { teams: number; who: string };

/**
 * Who actually runs each size, from the same platform rules pages the guide's
 * lesson 1 table is built from and links under itself.
 *
 * Deliberately not exhaustive. It exists so a reader who picks 14 is told that
 * this is Yahoo's public league and its 13-week season, rather than being left
 * to wonder whether the number means anything.
 */
export const KNOWN_COUNTS: KnownCount[] = [
  { teams: 12, who: "ESPN's stated minimum for a knockout league" },
  { teams: 14, who: "Yahoo public death leagues, which run 13 weeks" },
  { teams: 17, who: "the NFFC Eliminator" },
  { teams: 18, who: "Sleeper's recommendation, the FFPC Chop Classic and Fantasy Life" },
  { teams: 20, who: "ESPN's own worked example" },
  { teams: 32, who: "Sleeper's maximum" },
];

/** The format at this exact size, or null when no listed format uses it. */
export function knownCountFor(teams: number): KnownCount | null {
  return KNOWN_COUNTS.find((c) => c.teams === teams) ?? null;
}
