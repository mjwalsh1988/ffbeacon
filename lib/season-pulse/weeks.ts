/**
 * Week paths and phases for /season/week-N. Pure.
 *
 * THE SEGMENT CARRIES ITS OWN PREFIX. The App Router has no partial dynamic
 * segment, so the folder is `[week]` and the published URL is still
 * `/season/week-4`, the shape the searches use. `weekPath` is the only place
 * that builds one and `parseWeekSegment` the only place that reads one, so the
 * two cannot drift. Same arrangement as lib/waiver-wire/weeks.ts.
 */

import { REGULAR_SEASON_WEEKS } from "@/lib/nfl-week";

export const SEASON_PATH = "/season";

export function weekPath(week: number): string {
  return `${SEASON_PATH}/week-${week}`;
}

/** "week-4" to 4. Null for anything else, including "week-04" and "week-0". */
export function parseWeekSegment(segment: string | undefined | null): number | null {
  const match = /^week-([1-9][0-9]?)$/.exec(segment ?? "");
  if (!match) return null;
  const week = Number(match[1]);
  return week >= 1 && week <= REGULAR_SEASON_WEEKS ? week : null;
}

/**
 * A week has a page once the season has reached it. A week further out has no
 * results and no forecast, and an indexed shell that fills in a month later is
 * worse than a 404.
 */
export function isPublishableWeek(week: number, currentWeek: number): boolean {
  return week >= 1 && week <= Math.min(currentWeek, REGULAR_SEASON_WEEKS);
}

export type WeekPhase = "played" | "live";

/** A week before the live one is over. The live week is still being played. */
export function weekPhase(week: number, currentWeek: number): WeekPhase {
  return week < currentWeek ? "played" : "live";
}

/** The newest week every game of has been played. 0 before week 1 ends. */
export function lastCompletedWeek(currentWeek: number): number {
  return Math.max(0, Math.min(currentWeek - 1, REGULAR_SEASON_WEEKS));
}

/** The last week there can be any stat row for. 0 only when the clock is unset. */
export function throughWeek(currentWeek: number): number {
  return Math.max(0, Math.min(currentWeek, REGULAR_SEASON_WEEKS));
}

/** Every week that has a page, newest first. */
export function publishedWeeks(currentWeek: number): number[] {
  const last = throughWeek(currentWeek);
  return Array.from({ length: last }, (_, i) => last - i);
}
