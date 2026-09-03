/**
 * What state a week is in, and what the page is therefore FOR.
 *
 * The Lineups page answers two different questions depending on where a week
 * sits, and it used to answer only the first one:
 *
 *   BEFORE THE WEEK   "am I starting the right nine people" -- a projection,
 *                     an optimiser, a waiver wire, a cut list. Advice.
 *   AFTER THE WEEK    "how did that go, and what did it cost me" -- a result,
 *                     the best lineup that was available, the games it swung,
 *                     and where the season stands now. A report.
 *
 * Getting that wrong is not a cosmetic problem. A settled week rendered as
 * advice offers a manager waiver pickups for a week nobody can be claimed for
 * and headlines a projection for a game whose result is already on the
 * scoreboard, which reads as the page not knowing what day it is.
 *
 * PURE, and deliberately so: the phase is decided from four facts the caller
 * already holds, with no clock of its own. A function that reached for
 * `Date.now()` here would make the page untestable and would disagree with
 * Sleeper, which is the only authority on whether a week has settled.
 *
 * "LIVE" MEANS POINTS ARE ON THE BOARD, not that the calendar says so. Sleeper
 * publishes a matchup row for the current week from Tuesday, with every score
 * at zero until Thursday night, so a phase decided by week number alone would
 * label four quiet days "in progress" and show a roster of 0.0s as though that
 * were the state of play. The test is whether anybody has actually scored.
 */

/** Where a week sits, and what the page shows because of it. */
export type WeekPhase = "upcoming" | "live" | "final" | "unsettled";

export type WeekStatus = {
  phase: WeekPhase;
  /** The chip. Short, and a state rather than an instruction. */
  label: string;
  /** One sentence saying what the reader is looking at. */
  blurb: string;
  /** True when actual points should be the headline figure on every row. */
  showsResults: boolean;
  /** True when the page is advice: the optimiser, the wire, the cut list. */
  showsAdvice: boolean;
};

export function weekStatus(input: {
  week: number;
  currentWeek: number;
  /** Sleeper has settled the week. */
  isFinal: boolean;
  /** Anybody on this roster has scored anything yet. */
  hasLivePoints: boolean;
}): WeekStatus {
  const { week, currentWeek, isFinal, hasLivePoints } = input;

  if (isFinal) {
    return {
      phase: "final",
      label: "Final",
      blurb: "This week is over. Every number below is what actually happened.",
      showsResults: true,
      showsAdvice: false,
    };
  }

  if (hasLivePoints) {
    return {
      phase: "live",
      label: "In progress",
      blurb:
        "Games are being played. Scores update as they come in, and the best lineup is graded once the week settles.",
      showsResults: true,
      showsAdvice: false,
    };
  }

  // NOT FINAL, NOTHING SCORED, AND ALREADY BEHIND THE LIVE WEEK. Rare, and it
  // is a real state rather than an error: Sleeper occasionally leaves a week
  // unsettled, and a page that called it "upcoming" would offer waiver advice
  // for a week that has come and gone.
  if (week < currentWeek) {
    return {
      phase: "unsettled",
      label: "Not settled",
      blurb:
        "Sleeper has not marked this week final and no scores are published for it, so there is nothing to grade.",
      showsResults: false,
      showsAdvice: false,
    };
  }

  return {
    phase: "upcoming",
    label: week === currentWeek ? "This week" : "Upcoming",
    blurb:
      week === currentWeek
        ? "Nothing has been scored yet. Everything below is a projection, and your lineup can still change."
        : "This week has not been played. Everything below is a projection.",
    showsResults: false,
    showsAdvice: true,
  };
}

/**
 * True when any player scored anything.
 *
 * A SUM OF ABSOLUTE VALUES, because a defence can score negative points and a
 * plain sum of a week where one team scored -2 and everybody else scored
 * nothing would come to a negative number that is not zero but is also not
 * evidence of a game being played. Any non-zero entry is.
 */
export function hasLivePoints(actualByPlayer: Map<string, number>): boolean {
  for (const points of actualByPlayer.values()) {
    if (Number.isFinite(points) && points !== 0) return true;
  }
  return false;
}
