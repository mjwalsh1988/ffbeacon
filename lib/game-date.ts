/**
 * Game-day math shared by the daily games (Signal Scout, Long Shot). Pure,
 * zero I/O.
 *
 * Day math works on plain YYYY-MM-DD strings and never touches a local
 * timezone: each date string is parsed as UTC noon, then diffed or shifted
 * by exactly 86,400,000 ms. Noon avoids ever landing on a DST transition
 * instant, and whole UTC days are immune to the fact that a real
 * America/New_York calendar day can be 23, 24, or 25 hours long around a DST
 * change. Date.UTC already accounts for month lengths and leap years.
 *
 * currentEasternGameDate and isConsecutiveDay moved here from
 * lib/signal-scout/streaks.ts, which re-exports them so its importers do not
 * change.
 */

import { SITE_TIME_ZONE } from "@/lib/datetime";

const MS_PER_DAY = 86_400_000;

/** Parse a YYYY-MM-DD string as UTC noon of that calendar day. */
function parseIsoDateUtcNoon(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day, 12, 0, 0);
}

/** True when `next` is exactly the calendar day after `prev` (YYYY-MM-DD strings). */
export function isConsecutiveDay(prev: string, next: string): boolean {
  return parseIsoDateUtcNoon(next) - parseIsoDateUtcNoon(prev) === MS_PER_DAY;
}

/**
 * The current instant's calendar date in America/New_York, as YYYY-MM-DD.
 * `now` defaults to the live clock; pass it explicitly in tests for
 * determinism around DST boundaries.
 */
export function currentEasternGameDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SITE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

/**
 * True for a real calendar date written YYYY-MM-DD. A regex alone accepts
 * 2026-13-45, which Postgres then rejects as a 500.
 */
export function isValidGameDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d, 12, 0, 0);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

/** Shift a YYYY-MM-DD date by `n` calendar days (negative goes back). */
export function addDays(date: string, n: number): string {
  const shifted = new Date(parseIsoDateUtcNoon(date) + n * MS_PER_DAY);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
