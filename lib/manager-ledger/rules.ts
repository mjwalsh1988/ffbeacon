/**
 * The league rules the Manager Ledger grades under.
 *
 * Read off the stored Sleeper settings (leagues.metadata.settings), so the
 * engine and the page agree on one reading of them:
 *
 *   kind              redraft, dynasty, chopped or best ball, from
 *                     lib/league-category.ts, never re-derived here
 *   playoffWeekStart  the first playoff week. Records, wins left behind and the
 *                     scoring rank count regular season weeks only. Null when
 *                     the league runs no playoffs (Sleeper writes 0).
 *   medianGame        Sleeper's league_average_match: every regular season week
 *                     is also a game against the league median.
 *
 * Chopped leagues have no head-to-head game. Their weekly result is the cut
 * line: a team survives a week by outscoring the lowest score among the other
 * teams still alive. Best ball leagues set their own lineups, so there is no
 * lineup decision to grade.
 */

import { categorizeLeague, type LeagueCategoryKey } from "@/lib/league-category";
import type { SleeperLeague } from "@/lib/sleeper";

export type LedgerRules = {
  kind: LeagueCategoryKey;
  bestBall: boolean;
  chopped: boolean;
  /** First playoff week, or null when the league runs no playoffs. */
  playoffWeekStart: number | null;
  /** True when each regular season week is also a game against the median. */
  medianGame: boolean;
};

/** A plain redraft league with no playoffs and no median game. */
export const DEFAULT_LEDGER_RULES: LedgerRules = {
  kind: "redraft",
  bestBall: false,
  chopped: false,
  playoffWeekStart: null,
  medianGame: false,
};

export function ledgerRulesFromSettings(
  settings: Record<string, unknown> | null | undefined,
): LedgerRules {
  const s = settings ?? {};
  const kind = categorizeLeague({ settings: s } as unknown as SleeperLeague);
  const chopped = kind === "chopped";
  const playoff = Number(s.playoff_week_start);
  return {
    kind,
    bestBall: kind === "best-ball-dynasty" || kind === "best-ball-redraft",
    chopped,
    // A chopped league has no bracket; the cut runs every week.
    playoffWeekStart:
      !chopped && Number.isInteger(playoff) && playoff > 0 ? playoff : null,
    medianGame: !chopped && Number(s.league_average_match) === 1,
  };
}

/** True for a week before the playoffs (every week when there are none). */
export function isRegularSeasonWeek(week: number, rules: LedgerRules): boolean {
  return rules.playoffWeekStart === null || week < rules.playoffWeekStart;
}

/** A stable token for the fingerprint: a rules change is a different ledger. */
export function ledgerRulesToken(rules: LedgerRules): string {
  return [
    rules.kind,
    rules.playoffWeekStart ?? 0,
    rules.medianGame ? "median" : "nomedian",
  ].join(":");
}
