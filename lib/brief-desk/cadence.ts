/**
 * When an edition is due, and which period it covers.
 *
 * Pure and clock-free: takes the NFL state, the desk settings and `now`, and
 * returns the period whose close has most recently passed. Whether that period
 * already has an edition, and whether an off-season period holds enough
 * Relays, are database questions the bundle builder answers
 * (lib/brief-desk/bundle.ts); this file only does the calendar.
 *
 * The in-season period is the NFL week as lib/relays/week.ts defines it: it
 * opens at the previous close and closes at bd_run_hour_et on bd_run_weekday
 * (Tuesday 9 AM Eastern by default). The two files share the anchor
 * (seasonWeekOneOpen) so a Relay can never fall between two editions.
 *
 * Pre-season: weekly, same clock, counted in weeks to kickoff. Off-season:
 * periods close on the 1st and 16th at the close hour, or the 1st only when
 * bd_offseason_monthly is on.
 */

import { easternEpoch, easternParts, parseCalendarDate } from "@/lib/relays/eastern-time";
import {
  LAST_POST_SEASON_WEEK,
  REGULAR_SEASON_WEEKS,
  seasonForInstant,
  seasonWeekIndexAt,
  seasonWeekOpen,
  type NflStateLike,
  type RelayPhase,
  type WeekBoundary,
} from "@/lib/relays/week";
import { suggestedEditionSlug, suggestedEditionTitle } from "./slug";

export interface CadenceSettings {
  enabled: boolean;
  offSeasonMonthly: boolean;
  runWeekday: number;
  runHourEt: number;
}

export type EditionCadence = "weekly" | "biweekly" | "monthly";

export interface EditionPeriod {
  season: string;
  week: number | null;
  phase: RelayPhase;
  preSeasonWeek: number | null;
  cadence: EditionCadence;
  /** ISO instants. The period is [periodStart, periodEnd). */
  periodStart: string;
  periodEnd: string;
  suggestedSlug: string;
  suggestedTitle: string;
}

export interface CadenceResult {
  /** The most recently closed period, or null when the calendar cannot be read. */
  period: EditionPeriod | null;
  /** The next close after `now`, for the "not due yet" answer. */
  nextClose: string | null;
  reason: string;
}

const PRE_SEASON_WEEKS = 6;

function boundaryOf(settings: CadenceSettings): WeekBoundary {
  return { runWeekday: settings.runWeekday, runHourEt: settings.runHourEt };
}

/**
 * The instant week N opens. One implementation, shared with lib/relays/week.ts,
 * so a Relay can never fall between two editions: the week boundary there is
 * the edition close here, by construction rather than by agreement.
 */
function weekOpen(startDate: string, settings: CadenceSettings, n: number): number | null {
  return seasonWeekOpen(startDate, n, boundaryOf(settings));
}

/** The most recent off-season close at or before `at`, and the one before it. */
function offSeasonCloses(at: number, settings: CadenceSettings): { close: number; previous: number; next: number } {
  const days = settings.offSeasonMonthly ? [1] : [1, 16];
  const closesAround: number[] = [];
  const p = easternParts(at);
  for (const monthOffset of [-2, -1, 0, 1]) {
    const shifted = new Date(Date.UTC(p.year, p.month - 1 + monthOffset, 1, 12));
    for (const day of days) {
      closesAround.push(easternEpoch(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, day, settings.runHourEt));
    }
  }
  closesAround.sort((a, b) => a - b);
  let close = closesAround[0];
  let previous = closesAround[0];
  let next = closesAround[closesAround.length - 1];
  for (let i = 0; i < closesAround.length; i += 1) {
    if (closesAround[i] <= at) {
      previous = i > 0 ? closesAround[i - 1] : closesAround[i];
      close = closesAround[i];
      next = closesAround[i + 1] ?? closesAround[i];
    }
  }
  return { close, previous, next };
}

function period(
  season: string,
  phase: RelayPhase,
  week: number | null,
  preSeasonWeek: number | null,
  cadence: EditionCadence,
  start: number,
  end: number,
): EditionPeriod {
  const base = {
    season,
    week,
    phase,
    preSeasonWeek,
    periodEnd: new Date(end).toISOString(),
  };
  return {
    ...base,
    cadence,
    periodStart: new Date(start).toISOString(),
    suggestedSlug: suggestedEditionSlug(base),
    suggestedTitle: suggestedEditionTitle(base),
  };
}

/** The most recently closed period at `now`. */
export function resolveCadence(
  nflState: NflStateLike | null,
  settings: CadenceSettings,
  now: Date | number,
): CadenceResult {
  const at = now instanceof Date ? now.getTime() : now;
  if (!settings.enabled) return { period: null, nextClose: null, reason: "the desk is switched off (bd_enabled)" };
  if (!nflState) {
    return { period: null, nextClose: null, reason: "Sleeper's NFL state is unreachable; a period is never declared from a guess" };
  }

  const offCadence: EditionCadence = settings.offSeasonMonthly ? "monthly" : "biweekly";
  const startDate = nflState.season_start_date ?? null;
  const open1 = startDate ? weekOpen(startDate, settings, 1) : null;

  if (open1 === null) {
    // No calendar: only an off-season answer is honest, and only when Sleeper says so.
    if (nflState.season_type === "off") {
      const { close, previous, next } = offSeasonCloses(at, settings);
      return {
        period: period(nflState.season, "off", null, null, offCadence, previous, close),
        nextClose: new Date(next).toISOString(),
        reason: "off-season period from the calendar closes",
      };
    }
    return { period: null, nextClose: null, reason: "Sleeper's state carries no season_start_date, so the week boundaries cannot be computed" };
  }

  const season = nflState.season || seasonForInstant(at);
  // Which week window holds `now`: n such that open(n) <= now < open(n+1).
  // Read off the real Eastern opens, never a fixed seven-day millisecond grid:
  // after the November change the two disagree by an hour, and the cron fires
  // inside it, so an hour of Tuesday morning belonged to no edition at all.
  const n = seasonWeekIndexAt(startDate!, at, boundaryOf(settings))!;
  const openN = weekOpen(startDate!, settings, n)!;
  const openNext = weekOpen(startDate!, settings, n + 1)!;

  if (n >= 2 && n <= LAST_POST_SEASON_WEEK + 1) {
    // Week n-1 has just closed at open(n).
    const closedWeek = n - 1;
    const phase: RelayPhase = closedWeek <= REGULAR_SEASON_WEEKS ? "regular" : "post";
    return {
      period: period(season, phase, closedWeek, null, "weekly", weekOpen(startDate!, settings, closedWeek)!, openN),
      nextClose: new Date(openNext).toISOString(),
      reason: `week ${closedWeek} closed`,
    };
  }

  if (n <= 1 && n >= 1 - PRE_SEASON_WEEKS) {
    // Pre-season: the closed period is the week before this one, counted in weeks to kickoff.
    const weeksToKickoff = 1 - n + 1; // the CLOSED week's distance
    if (n === 1 - PRE_SEASON_WEEKS) {
      // The first pre-season week is open and nothing pre-season has closed yet,
      // so the closed period is still an off-season one. Read the closes from
      // `at`, not from this week's open: reading them from the open froze the
      // answer for the whole week and the off-season close that landed inside it
      // never became a period, leaving a hole nothing covered.
      const { close, previous, next } = offSeasonCloses(at, settings);
      return {
        period: period(season, "off", null, null, offCadence, previous, close),
        nextClose: new Date(Math.min(next, openNext)).toISOString(),
        reason: "the last off-season period closed; pre-season begins",
      };
    }
    // The first pre-season period starts at the last off-season close rather
    // than a week before its own open, so the two grids hand over with no gap
    // and no overlap.
    const start =
      n - 1 === 1 - PRE_SEASON_WEEKS
        ? offSeasonCloses(openN, settings).close
        : weekOpen(startDate!, settings, n - 1)!;
    return {
      period: period(season, "pre", null, weeksToKickoff, "weekly", start, openN),
      nextClose: new Date(openNext).toISOString(),
      reason: `pre-season, ${weeksToKickoff} weeks to kickoff closed`,
    };
  }

  // Off-season, either side of the season.
  const { close, previous, next } = offSeasonCloses(at, settings);
  const offSeason = n > LAST_POST_SEASON_WEEK + 1 ? season : seasonForInstant(at);
  return {
    period: period(offSeason, "off", null, null, offCadence, previous, close),
    nextClose: new Date(next).toISOString(),
    reason: "off-season period closed",
  };
}

/**
 * The period that CONTAINS an instant, for the admin override that names a
 * past week or an off-season close.
 */
export function periodForWeek(
  nflState: NflStateLike,
  settings: CadenceSettings,
  week: number,
): EditionPeriod | null {
  const startDate = nflState.season_start_date ?? null;
  if (!startDate || week < 1 || week > LAST_POST_SEASON_WEEK) return null;
  const start = weekOpen(startDate, settings, week);
  const end = weekOpen(startDate, settings, week + 1);
  if (start === null || end === null) return null;
  return period(nflState.season, week <= REGULAR_SEASON_WEEKS ? "regular" : "post", week, null, "weekly", start, end);
}

/** The off-season period that closed on a given calendar date. */
export function periodForOffSeasonClose(
  nflState: NflStateLike,
  settings: CadenceSettings,
  closeDate: string,
): EditionPeriod | null {
  const d = parseCalendarDate(closeDate);
  if (!d) return null;
  const close = easternEpoch(d.year, d.month, d.day, settings.runHourEt);
  const { close: resolved, previous } = offSeasonCloses(close, settings);
  if (resolved !== close) return null;
  return period(
    nflState.season || seasonForInstant(close),
    "off",
    null,
    null,
    settings.offSeasonMonthly ? "monthly" : "biweekly",
    previous,
    close,
  );
}
