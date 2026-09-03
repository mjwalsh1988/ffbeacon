/**
 * Which weeks the Lineups picker offers, and which one it lands on.
 *
 * Pure, and in lib/ rather than in the route file for a reason the build
 * enforces: a Next App Router page may only export the handful of names the
 * framework recognises, so a helper exported from a page for its own tests
 * fails the type check. Splitting it out is the fix, and it is the better shape
 * anyway.
 */

import { MAX_MATCHUP_WEEK } from "@/lib/league-matchups";

export type LineupWeekOption = {
  week: number;
  isFinal: boolean;
  isCurrent: boolean;
};

/**
 * The week picker's options.
 *
 * Built from the stored slate when there is one, and from the regular season
 * itself when there is not. A league in the preseason has no matchups stored
 * and still has a season a manager might want to look through, so an empty
 * picker would strand them on whatever week the page defaulted to with no way
 * to move.
 *
 * `isCurrent` is never true on a week that has already settled. Sleeper's
 * `leg` can sit on a week whose games are done, and labelling that "this week"
 * beside a final score reads as a page that has not noticed the games were
 * played.
 */
export function buildWeekOptions(
  stored: Array<{ week: number; isFinal: boolean }>,
  currentWeek: number,
  playoffWeekStart: number,
): LineupWeekOption[] {
  if (stored.length > 0) {
    return stored
      .map((row) => ({
        week: row.week,
        isFinal: row.isFinal,
        isCurrent: row.week === currentWeek && !row.isFinal,
      }))
      .sort((a, b) => a.week - b.week);
  }

  const last = Math.min(Math.max(playoffWeekStart - 1, 1), MAX_MATCHUP_WEEK);
  const out: LineupWeekOption[] = [];
  for (let week = 1; week <= last; week += 1) {
    out.push({ week, isFinal: false, isCurrent: week === currentWeek });
  }
  return out;
}

/**
 * The week to show: the requested one when it exists, otherwise the live one,
 * otherwise the first on the slate.
 *
 * A `?week=` naming a week this league does not have falls back rather than
 * rendering an empty page. That is the shareable-link case: a link built in
 * week 12 of one league, opened against another that only has eight weeks
 * stored, should show something.
 */
export function clampWeek(
  options: LineupWeekOption[],
  requested: number | null,
  currentWeek: number,
): number {
  if (requested !== null && options.some((o) => o.week === requested)) return requested;
  if (options.some((o) => o.week === currentWeek)) return currentWeek;
  return options[0]?.week ?? currentWeek;
}
