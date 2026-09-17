/**
 * Which NFL week a post belongs to.
 *
 * Pure, and shared by the live pipeline, the one-time backfill and the Brief
 * cadence (lib/brief-desk/cadence.ts), so a Relay can never fall between two
 * editions: the week boundary here is the edition close there.
 *
 * THE BOUNDARY IS TUESDAY MORNING EASTERN, NOT THURSDAY KICKOFF. Sleeper's
 * season_start_date is the Thursday of week 1. A report posted on the Tuesday
 * before it is week 1 news to every reader, and the Brief for week N closes on
 * the Tuesday after week N's Monday night game (WEEK_CLOSE_WEEKDAY at
 * WEEK_CLOSE_HOUR_ET). So week N runs from that Tuesday 9 AM Eastern to the
 * next, and the first boundary sits two days before the start date.
 *
 * The stored `week` is a REGULAR or POST season week only. Pre-season and
 * off-season posts carry week null, with the phase reported alongside so a
 * caller that wants to say "pre-season week 2" can. Storing a pre-season week
 * number in the same column as a regular-season one would make week 2 mean two
 * different things in the same table, and the Brief's own cadence keys periods
 * on timestamps rather than on this number, so nothing needs the collision.
 */

import { easternAddDaysAt, easternEpoch, easternParts, parseCalendarDate } from "./eastern-time";

/** Tuesday. */
export const WEEK_CLOSE_WEEKDAY = 2;
/** 9 AM Eastern, after Monday night's game has settled and the box scores synced. */
export const WEEK_CLOSE_HOUR_ET = 9;

/** How many regular-season weeks the NFL plays. */
export const REGULAR_SEASON_WEEKS = 18;
/** Weeks 19 to 22 are the playoffs through the Super Bowl. */
export const LAST_POST_SEASON_WEEK = 22;
/** How many weeks before kickoff the pre-season phase begins. */
export const PRE_SEASON_WEEKS = 6;

/**
 * Where a week boundary falls, in Eastern wall-clock terms. The cadence reads
 * the admin-editable `bd_run_weekday` and `bd_run_hour_et` into this shape, so
 * the two files step the same grid whatever the owner sets.
 */
export interface WeekBoundary {
  /** 0 is Sunday, matching Date.getDay(). */
  runWeekday: number;
  runHourEt: number;
}

export const DEFAULT_WEEK_BOUNDARY: WeekBoundary = {
  runWeekday: WEEK_CLOSE_WEEKDAY,
  runHourEt: WEEK_CLOSE_HOUR_ET,
};

export type RelayPhase = "off" | "pre" | "regular" | "post";

export interface NflStateLike {
  season: string;
  /** "pre", "regular", "post" or "off". */
  season_type?: string | null;
  week?: number | null;
  /** YYYY-MM-DD, the Thursday of week 1. */
  season_start_date?: string | null;
}

export interface RelayWeekAssignment {
  /** The season the post belongs to, as Sleeper writes it. */
  season: string;
  /** Regular or post season week; null in the pre-season and the off-season. */
  week: number | null;
  phase: RelayPhase;
  /** Pre-season only: which pre-season week, counted back from kickoff. */
  preSeasonWeek: number | null;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * The instant week N opens: the close weekday at the close hour, N-1 weeks
 * after the week-one anchor. N may be 0 or negative for pre-season weeks.
 *
 * Every step is Eastern CALENDAR arithmetic through `easternAddDaysAt`, never a
 * fixed 604800000 milliseconds. A seven-day millisecond step drifts an hour out
 * of the wall clock the moment the November change lands, which put the week 9
 * boundary at 8 AM Eastern instead of 9 and let an hour of Tuesday morning fall
 * between two editions.
 */
export function seasonWeekOpen(
  seasonStartDate: string,
  n: number,
  boundary: WeekBoundary = DEFAULT_WEEK_BOUNDARY,
): number | null {
  const d = parseCalendarDate(seasonStartDate);
  if (!d) return null;
  const kickoffNoon = easternEpoch(d.year, d.month, d.day, 12);
  const back = (easternParts(kickoffNoon).weekday - boundary.runWeekday + 7) % 7;
  return easternAddDaysAt(kickoffNoon, -back + 7 * (n - 1), boundary.runHourEt);
}

/**
 * The week window that holds an instant: n such that open(n) <= at < open(n+1).
 *
 * The millisecond grid supplies the estimate and the real Eastern opens correct
 * it, so the answer is right on both sides of a daylight saving change.
 */
export function seasonWeekIndexAt(
  seasonStartDate: string,
  at: number,
  boundary: WeekBoundary = DEFAULT_WEEK_BOUNDARY,
): number | null {
  const open1 = seasonWeekOpen(seasonStartDate, 1, boundary);
  if (open1 === null) return null;
  let n = Math.floor((at - open1) / WEEK_MS) + 1;
  while ((seasonWeekOpen(seasonStartDate, n, boundary) as number) > at) n -= 1;
  while ((seasonWeekOpen(seasonStartDate, n + 1, boundary) as number) <= at) n += 1;
  return n;
}

/**
 * The season a calendar instant belongs to, using the same March rollover
 * lib/nfl-season.ts uses for "now", read off the given instant instead.
 */
export function seasonForInstant(at: Date | number): string {
  const p = easternParts(at);
  return String(p.month >= 3 ? p.year : p.year - 1);
}

/**
 * The instant week 1 opens: Tuesday 9 AM Eastern, two days before the Thursday
 * kickoff Sleeper publishes as season_start_date.
 */
export function seasonWeekOneOpen(
  seasonStartDate: string,
  boundary: WeekBoundary = DEFAULT_WEEK_BOUNDARY,
): number | null {
  return seasonWeekOpen(seasonStartDate, 1, boundary);
}

/**
 * Assign a season, phase and week to a post.
 *
 * With a season_start_date the answer is arithmetic on the post's own
 * timestamp, which is what makes history and the live path share one rule.
 * Without one (Sleeper unreachable, or a state object from before it carried
 * the field) the live season_type and week are used as Sleeper reports them,
 * which is the right answer for a post being ingested right now.
 */
export function assignRelayWeek(
  state: NflStateLike | null,
  postedAt: Date | string | number,
  boundary: WeekBoundary = DEFAULT_WEEK_BOUNDARY,
): RelayWeekAssignment {
  const posted = postedAt instanceof Date ? postedAt.getTime() : new Date(postedAt).getTime();
  const fallbackSeason = Number.isNaN(posted)
    ? (state?.season ?? "")
    : seasonForInstant(posted);

  const startDate = state?.season_start_date ?? null;
  const weekOneOpen = startDate ? seasonWeekOneOpen(startDate, boundary) : null;

  if (startDate && weekOneOpen !== null && !Number.isNaN(posted)) {
    const season = state?.season && sameSeasonWindow(posted, weekOneOpen) ? state.season : fallbackSeason;
    const n = seasonWeekIndexAt(startDate, posted, boundary) as number;
    if (n <= 0) {
      if (n >= 1 - PRE_SEASON_WEEKS) {
        return { season, week: null, phase: "pre", preSeasonWeek: 1 - n };
      }
      return { season, week: null, phase: "off", preSeasonWeek: null };
    }
    if (n <= REGULAR_SEASON_WEEKS) {
      return { season, week: n, phase: "regular", preSeasonWeek: null };
    }
    if (n <= LAST_POST_SEASON_WEEK) {
      return { season, week: n, phase: "post", preSeasonWeek: null };
    }
    return { season, week: null, phase: "off", preSeasonWeek: null };
  }

  // No start date: trust Sleeper's live reading for a post that is live now.
  const type = state?.season_type ?? "off";
  const season = state?.season ?? fallbackSeason;
  const liveWeek =
    typeof state?.week === "number" && Number.isFinite(state.week) ? state.week : null;
  if (type === "regular" && liveWeek) {
    return { season, week: liveWeek, phase: "regular", preSeasonWeek: null };
  }
  if (type === "post" && liveWeek) {
    // Sleeper counts playoff weeks from 1 again in some seasons and continues
    // from 19 in others; normalise to the continuing count the table stores.
    const week = liveWeek <= REGULAR_SEASON_WEEKS ? REGULAR_SEASON_WEEKS + liveWeek : liveWeek;
    return { season, week, phase: "post", preSeasonWeek: null };
  }
  if (type === "pre") {
    return { season, week: null, phase: "pre", preSeasonWeek: liveWeek };
  }
  return { season, week: null, phase: "off", preSeasonWeek: null };
}

/** True when the post sits inside a year of the season's kickoff, so the state's
 * own season label applies rather than the calendar rollover. */
function sameSeasonWindow(posted: number, weekOneOpen: number): boolean {
  return posted >= weekOneOpen - 200 * DAY_MS && posted <= weekOneOpen + 200 * DAY_MS;
}
