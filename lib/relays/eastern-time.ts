/**
 * Eastern-time arithmetic with no dependencies, shared by lib/relays/week.ts
 * and lib/brief-desk/cadence.ts.
 *
 * Both need the same thing: the instant at which a wall-clock time in
 * America/New_York falls on a given calendar date. That is what lets the week
 * boundary and the edition close be the same Tuesday 9 AM whether the calendar
 * says EDT or EST, without hardcoding either offset. Pure and clock-free; every
 * function takes the date it works on.
 */

import { SITE_TIME_ZONE } from "@/lib/datetime";

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hour12: false,
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface EasternParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 is Sunday, matching Date.getDay(). */
  weekday: number;
}

/** The Eastern wall-clock reading of an instant. */
export function easternParts(at: Date | number | string): EasternParts {
  const d = at instanceof Date ? at : new Date(at);
  const parts = PARTS.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const hourRaw = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // Some runtimes print midnight as 24 under hour12: false.
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/**
 * The instant at which `year-month-day hour:minute` occurs in America/New_York.
 *
 * Solved by iteration rather than by a stored offset table: take the UTC guess,
 * read what Eastern wall-clock it lands on, and correct by the difference. Two
 * passes converge for every date, including the two DST transition days.
 */
export function easternEpoch(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const p = easternParts(guess);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const diff = target - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

/** The instant of `hour:00` Eastern on the same Eastern calendar date as `at`. */
export function easternSameDayAt(at: Date | number, hour: number, minute = 0): number {
  const p = easternParts(at);
  return easternEpoch(p.year, p.month, p.day, hour, minute);
}

/** Add whole days to an Eastern calendar date and return the instant of `hour` on that day. */
export function easternAddDaysAt(
  at: Date | number,
  days: number,
  hour: number,
  minute = 0,
): number {
  const p = easternParts(at);
  // Date.UTC normalises day overflow, so adding to the day component is safe.
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days, 12));
  return easternEpoch(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    hour,
    minute,
  );
}

/** Parse a YYYY-MM-DD calendar date (Sleeper's season_start_date shape). */
export function parseCalendarDate(
  value: string | null | undefined,
): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}
