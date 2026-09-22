/**
 * Which week is a waiver board for, and which weeks may have one.
 *
 * Pure and clock-free. The caller passes the live week in; nothing here reads
 * a Date, so a test can pin any point in a season and the answer is the same
 * on a UTC server and in a Hawaii browser.
 *
 * WHY THE FUTURE IS CAPPED AT ONE WEEK AHEAD. Sleeper publishes the full
 * schedule at league creation but publishes weekly PROJECTIONS about a week
 * out, so a page for week 12 built in week 3 would be a page of blanks with a
 * real-looking heading on it. One week ahead is the Tuesday-evening reader who
 * is setting next week's claims, and that page has real numbers on it.
 *
 * WHY THE PAST IS KEPT. A week that has been played still answers "what did
 * the wire look like" and still holds every link a reader shared on the
 * Tuesday. Removing it would break those links and would delete the only part
 * of this feature that accumulates.
 */

import { MAX_NFL_WEEK } from "./types";

/** Weeks a board may be requested for, given where the season is. */
export function boardWeeks(currentWeek: number): number[] {
  const last = Math.min(MAX_NFL_WEEK, Math.max(1, currentWeek) + 1);
  const out: number[] = [];
  for (let w = 1; w <= last; w += 1) out.push(w);
  return out;
}

/** True when a board for this week is one we are willing to publish. */
export function isPublishableWeek(week: number, currentWeek: number): boolean {
  return Number.isInteger(week) && boardWeeks(currentWeek).includes(week);
}

/**
 * Parse a `week` route segment.
 *
 * The route is `/waiver-wire/week-4`, so the segment arrives as "week-4" from
 * the URL and occasionally as "4" from an internal caller. Both are accepted;
 * anything else is null, and the route renders a 404 rather than guessing.
 */
export function parseWeekSegment(segment: string | undefined | null): number | null {
  if (!segment) return null;
  const match = /^(?:week-)?(\d{1,2})$/.exec(segment.trim().toLowerCase());
  if (!match) return null;
  const week = Number(match[1]);
  if (!Number.isInteger(week) || week < 1 || week > MAX_NFL_WEEK) return null;
  return week;
}

/** The canonical path for one week's board. */
export function weekPath(week: number): string {
  return `/waiver-wire/week-${week}`;
}

/**
 * Where a week sits relative to now, which decides every tense on the page.
 *
 * "current" is the week whose waivers a reader is bidding into. "past" has been
 * played and reads as a record. "upcoming" is next week, where the projections
 * exist but the games have not been played and nothing is settled.
 */
export type WeekPhase = "past" | "current" | "upcoming";

export function weekPhase(week: number, currentWeek: number): WeekPhase {
  if (week < currentWeek) return "past";
  if (week > currentWeek) return "upcoming";
  return "current";
}

/**
 * The plain-language stretch of season a week belongs to.
 *
 * Used in copy rather than in arithmetic: the advice genuinely differs between
 * the first waiver run of the year (everybody has a full budget and no
 * information) and the trade deadline (half the league has nothing left to
 * spend). The boundaries match the phase buckets the FAAB market priors are
 * measured in, so a sentence here and a number there describe the same weeks.
 */
export function weekPhaseLabel(week: number): string {
  if (week <= 1) return "Opening week";
  if (week <= 6) return "Early season";
  if (week <= 10) return "Midseason";
  if (week <= 13) return "Playoff push";
  return "Fantasy playoffs";
}

/**
 * The two neighbours of a week, for the previous/next links under the board.
 *
 * Null on either side where there is no publishable week there, so the page
 * renders one arrow rather than a dead one.
 */
export function weekNeighbours(
  week: number,
  currentWeek: number,
): { prev: number | null; next: number | null } {
  const weeks = boardWeeks(currentWeek);
  const i = weeks.indexOf(week);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: i > 0 ? weeks[i - 1] : null,
    next: i < weeks.length - 1 ? weeks[i + 1] : null,
  };
}
