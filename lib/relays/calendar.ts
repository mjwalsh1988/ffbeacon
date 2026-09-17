/**
 * The calendar view's arithmetic: which Eastern calendar day a Relay belongs
 * to, the instant range a day or a month covers, and the grid of days a month
 * renders as. Pure and clock-free; every function takes the date it works on.
 *
 * A Relay's day is the Eastern calendar date of its source post, the same
 * clock every timestamp on the site is shown in, so a report posted at 10:30
 * PM Eastern on the 16th sits on the 16th even though it is the 17th in UTC.
 * The grid itself is plain calendar arithmetic and needs no zone: the 1st of
 * September is a Tuesday everywhere.
 */

import { SITE_TIME_ZONE } from "@/lib/datetime";
import { easternAddDaysAt, easternEpoch, easternParts, parseCalendarDate } from "./eastern-time";

export type CalendarDay = {
  /** YYYY-MM-DD */
  key: string;
  day: number;
  /** False for the leading and trailing days that pad the first and last week. */
  inMonth: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The Eastern calendar date of an instant, as YYYY-MM-DD. */
export function easternDateKey(iso: string | number | Date): string {
  const p = easternParts(iso);
  return dateKey(p.year, p.month, p.day);
}

/** "YYYY-MM" from the address, or null. */
export function parseMonthKey(raw: string | undefined): { year: number; month: number } | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  return { year, month };
}

/** "YYYY-MM-DD" from the address, or null when it is not a real date. */
export function parseDateKey(raw: string | undefined): { year: number; month: number; day: number } | null {
  const p = parseCalendarDate(raw);
  if (!p || p.year < 2000 || p.year > 2100) return null;
  if (p.day > daysInMonth(p.year, p.month)) return null;
  return p;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function shiftMonth(year: number, month: number, by: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + by, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** The half-open instant range [start, end) of one Eastern calendar day. */
export function dayRange(year: number, month: number, day: number): { start: string; end: string } {
  const start = easternEpoch(year, month, day, 0, 0);
  const end = easternAddDaysAt(start, 1, 0, 0);
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/** The half-open instant range [start, end) of one Eastern calendar month. */
export function monthRange(year: number, month: number): { start: string; end: string } {
  const next = shiftMonth(year, month, 1);
  return {
    start: new Date(easternEpoch(year, month, 1, 0, 0)).toISOString(),
    end: new Date(easternEpoch(next.year, next.month, 1, 0, 0)).toISOString(),
  };
}

/**
 * The month as rows of seven days, Sunday first, padded with the neighbouring
 * months' days so every row is full.
 */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const count = daysInMonth(year, month);
  const cells: CalendarDay[] = [];
  const prev = shiftMonth(year, month, -1);
  const prevCount = daysInMonth(prev.year, prev.month);
  for (let i = firstWeekday - 1; i >= 0; i -= 1) {
    const day = prevCount - i;
    cells.push({ key: dateKey(prev.year, prev.month, day), day, inMonth: false });
  }
  for (let day = 1; day <= count; day += 1) cells.push({ key: dateKey(year, month, day), day, inMonth: true });
  const next = shiftMonth(year, month, 1);
  for (let day = 1; cells.length % 7 !== 0; day += 1) {
    cells.push({ key: dateKey(next.year, next.month, day), day, inMonth: false });
  }
  const rows: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { timeZone: SITE_TIME_ZONE, month: "long", year: "numeric" });

/** "September 2026". */
export function monthLabel(year: number, month: number): string {
  return MONTH_LABEL.format(new Date(easternEpoch(year, month, 1, 12)));
}

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
