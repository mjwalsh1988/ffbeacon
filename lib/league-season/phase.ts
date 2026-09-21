/**
 * Where a league is in its season, and who won it.
 *
 * Every League Pulse surface that behaves differently once a season is over
 * asks this module, and nothing re-derives the rule for itself. Pure: no I/O,
 * no clock. Everything arrives as data the sync has already stored.
 *
 * THE TWO WAYS A LEAGUE ENDS, because this product has both:
 *
 *   A bracket league ends when somebody wins the championship match. Sleeper
 *   marks that match `p: 1` in the winners bracket, and `w` is the roster that
 *   won it. That is a FACT rather than a date, which is why a decided bracket
 *   counts as complete even when Sleeper has not yet flipped the league's
 *   status: the question the UI is asking is "has a champion been decided",
 *   and the bracket has answered it.
 *
 *   A chopped league has no bracket. One roster is eliminated every week and
 *   the season ends when one is left, so the champion is the last roster with
 *   no elimination week against it. See lib/chopped/league.ts for why a falsy
 *   zero in `eliminated` is a live team rather than one chopped in week zero.
 *
 * A league can be complete WITHOUT a champion: Sleeper says the season is over
 * but the bracket never got played, or was never captured. That is a real
 * state and it is reported as one (`phase: "complete"`, `champion: null`)
 * rather than being rounded to either neighbour. A post-season page still
 * renders; it just has no name to put on the trophy.
 */

import { eliminatedWeek, isChoppedLeague } from "@/lib/chopped/league";
import { isDraftPending } from "@/lib/league-readiness";
import { bracketChampion, type SleeperBracketMatch } from "@/lib/sleeper";

export type LeaguePhase = "pre_draft" | "in_season" | "complete";

/** How we know who won. */
export type ChampionSource = "bracket" | "last_standing";

export type LeagueChampion = {
  sleeperRosterId: number;
  source: ChampionSource;
};

/** One elimination in a chopped league. */
export type ChopEvent = {
  sleeperRosterId: number;
  /** The week the roster was chopped. Always 1 or more. */
  week: number;
};

export type LeagueOutcome = {
  phase: LeaguePhase;
  /** A chopped (guillotine) league, which changes how it ends. */
  chopped: boolean;
  /** Null until a champion is decided, and in a completed league with no bracket. */
  champion: LeagueChampion | null;
  /** Bracket leagues only, and only when the championship match names a loser. */
  runnerUpRosterId: number | null;
  /** Chopped leagues only. Newest chop first. */
  chops: ChopEvent[];
  /** Chopped leagues only. The most recent chop, or null before the first one. */
  latestChop: ChopEvent | null;
  /** Chopped leagues only. Rosters with no elimination week against them. */
  aliveCount: number;
};

/** A roster as this module needs it: its id and whatever Sleeper settings we stored. */
export type OutcomeRoster = {
  sleeperRosterId: number;
  /** `rosters.metadata.settings`, or null. */
  settings?: Record<string, unknown> | null;
};

export type ResolveOutcomeInput = {
  /** `leagues.status`, verbatim from Sleeper. */
  status: string | null | undefined;
  /** The raw Sleeper league `settings` object. */
  settings: Record<string, unknown> | null | undefined;
  /** `leagues.metadata.brackets.winners`, as stored by captureLeagueBrackets. */
  winnersBracket?: unknown;
  rosters: OutcomeRoster[];
};

/**
 * The championship match's winner and loser.
 *
 * A thin guard over `bracketChampion` in lib/sleeper.ts, which is the one
 * reader of this blob in the codebase and is already used by Manager Pulse
 * against the same `leagues.metadata.brackets.winners`. A second
 * implementation is how two League Pulse surfaces end up disagreeing about the
 * same league with nothing to say which is right, so there is one.
 *
 * What that helper guarantees, and this depends on: it finds the match by
 * PLACEMENT (`p: 1`, the title game) rather than by the highest round, because
 * a bracket with a bye can end on a round that is not the final; the
 * third-place game carries `p: 3` and is never read; and a title match with no
 * `w` has not been played, so it decides nothing.
 *
 * All this adds is the array guard, because the caller hands us whatever was
 * in the jsonb column.
 */
function bracketResult(winnersBracket: unknown): {
  championRosterId: number;
  runnerUpRosterId: number | null;
} | null {
  if (!Array.isArray(winnersBracket)) return null;
  const { championRosterId, runnerUpRosterId } = bracketChampion(
    winnersBracket as SleeperBracketMatch[],
  );
  if (championRosterId === null) return null;
  return { championRosterId, runnerUpRosterId };
}

/** Every elimination on record, newest first, with ties broken by roster id. */
function chopEvents(rosters: OutcomeRoster[]): ChopEvent[] {
  const out: ChopEvent[] = [];
  for (const roster of rosters) {
    const week = eliminatedWeek(roster.settings ?? null);
    if (week === null) continue;
    out.push({ sleeperRosterId: roster.sleeperRosterId, week });
  }
  out.sort((a, b) => b.week - a.week || a.sleeperRosterId - b.sleeperRosterId);
  return out;
}

export function resolveLeagueOutcome(
  input: ResolveOutcomeInput,
): LeagueOutcome {
  const chopped = isChoppedLeague(input.settings ?? null);
  const status = (input.status ?? "").toLowerCase();

  const chops = chopped ? chopEvents(input.rosters) : [];
  const aliveCount = chopped ? input.rosters.length - chops.length : 0;

  // A chopped league is over when one roster is left standing, and it has to
  // have actually chopped somebody to get there: a one-team league that never
  // started is not a league with a champion.
  const lastStanding =
    chopped && chops.length > 0 && aliveCount === 1
      ? (input.rosters.find(
          (r) => eliminatedWeek(r.settings ?? null) === null,
        )?.sleeperRosterId ?? null)
      : null;

  const bracket = chopped ? null : bracketResult(input.winnersBracket);

  const champion: LeagueChampion | null = bracket
    ? { sleeperRosterId: bracket.championRosterId, source: "bracket" }
    : lastStanding !== null
      ? { sleeperRosterId: lastStanding, source: "last_standing" }
      : null;

  let phase: LeaguePhase;
  if (champion !== null || status === "complete") {
    phase = "complete";
  } else if (isDraftPending(status)) {
    phase = "pre_draft";
  } else {
    phase = "in_season";
  }

  return {
    phase,
    chopped,
    champion,
    runnerUpRosterId: bracket?.runnerUpRosterId ?? null,
    chops,
    latestChop: chops[0] ?? null,
    aliveCount,
  };
}

/**
 * Is this chop the one that just happened?
 *
 * `currentWeek` is the first UNPLAYED week, so the week that just settled is
 * the one before it. A reader opening the page on a Tuesday wants "who went
 * out on Sunday", and a chop from four weeks ago is history rather than news.
 * The card names the week either way; this only decides how it is introduced.
 */
export function isChopThisWeek(
  chop: ChopEvent | null,
  currentWeek: number,
): boolean {
  if (!chop) return false;
  return chop.week === Math.floor(currentWeek) - 1;
}
