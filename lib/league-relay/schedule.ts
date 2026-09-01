/**
 * When the relay's scheduled messages go out.
 *
 * THE CRON IS THE TICK. THE ADMIN PANEL IS THE SCHEDULE. The relay cron fires
 * every fifteen minutes because that is how often a community league resyncs.
 * Whether a given tick also posts a matchup preview or a recap is decided here,
 * against the weekday and hour an admin picked in America/New_York.
 *
 * IT HAS TO BE EASTERN, AND IT HAS TO BE RESOLVED RATHER THAN OFFSET. Vercel
 * schedules in UTC and the UTC-to-Eastern offset moves twice a year. A job
 * pinned to 15:00 UTC is 11am for seven months and 10am for five, and an admin
 * who asked for 11am would never be told. Reading the parts through Intl in
 * America/New_York is right on both sides of the boundary and needs no DST
 * table.
 *
 * Pure and clock-free: every function takes the instant it should reason about.
 */

import { SITE_TIME_ZONE } from "@/lib/datetime";
import { WEEKDAY_LABELS } from "./default-settings";

/** The Eastern date, weekday and hour of an instant. */
export interface EasternMoment {
  /** "2026-09-02" in Eastern. */
  date: string;
  /** 0 is Sunday, matching Date#getDay and the weekday settings. */
  weekday: number;
  /** 0 to 23, Eastern. */
  hour: number;
  /** "2026-09-02-14". What an hourly claim is recorded under. */
  hourKey: string;
}

const MOMENT_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
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

/**
 * Which Eastern date, weekday and hour an instant falls in.
 *
 * en-CA with 2-digit parts gives ISO-ordered fields, and the parts are read by
 * type rather than by splitting the formatted string, so a locale data update
 * that changes the separator cannot silently move the date.
 */
export function easternMoment(at: Date): EasternMoment {
  const parts = MOMENT_FORMAT.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // hourCycle h23 renders midnight as "24" in some ICU versions; fold it back.
  const rawHour = Number(get("hour"));
  const hour = Number.isFinite(rawHour) ? rawHour % 24 : 0;
  const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;
  return { date, weekday, hour, hourKey: `${date}-${String(hour).padStart(2, "0")}` };
}

/**
 * Is this tick inside the preview window?
 *
 * The hour is compared, not the minute, because the cron ticks four times an
 * hour. All four ticks inside the preview hour answer yes; the ledger's unique
 * dedupe key is what stops that from being four posts.
 */
export function isPreviewWindow(
  at: Date,
  cfg: { preview_weekday: number; preview_hour: number },
): boolean {
  const m = easternMoment(at);
  return m.weekday === cfg.preview_weekday && m.hour === cfg.preview_hour;
}

/**
 * Is this tick inside the recap window?
 *
 * A RANGE rather than a single hour, because recaps go out one an hour until
 * the week's slate is covered. Which hours actually post is then decided by the
 * hourly claim: at most one recap per league per Eastern hour.
 */
export function isRecapWindow(
  at: Date,
  cfg: { recap_weekday: number; recap_start_hour: number; recap_end_hour: number },
): boolean {
  const m = easternMoment(at);
  if (m.weekday !== cfg.recap_weekday) return false;
  return m.hour >= cfg.recap_start_hour && m.hour <= cfg.recap_end_hour;
}

/** "11:00 AM", "3:00 PM". The label the admin panel puts beside each hour. */
export function describeHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
}

/** The preview schedule in one line, for the admin panel. */
export function describePreviewSchedule(cfg: {
  preview_weekday: number;
  preview_hour: number;
  preview_headline: boolean;
  preview_undercard: boolean;
}): string {
  const games = [
    cfg.preview_headline ? "the headline game" : null,
    cfg.preview_undercard ? "one undercard" : null,
  ].filter((g): g is string => g !== null);
  if (games.length === 0) return "No games selected, so nothing will post.";
  const day = WEEKDAY_LABELS[cfg.preview_weekday] ?? "Wednesday";
  return `${day}s at ${describeHour(cfg.preview_hour)} Eastern, ${games.join(" and ")}.`;
}

/** The recap schedule in one line, for the admin panel. */
export function describeRecapSchedule(cfg: {
  recap_weekday: number;
  recap_start_hour: number;
  recap_end_hour: number;
}): string {
  const day = WEEKDAY_LABELS[cfg.recap_weekday] ?? "Tuesday";
  const slots = Math.max(0, cfg.recap_end_hour - cfg.recap_start_hour + 1);
  return `${day}s, one game an hour from ${describeHour(cfg.recap_start_hour)} to ${describeHour(
    cfg.recap_end_hour,
  )} Eastern. Room for ${slots} game${slots === 1 ? "" : "s"} a week.`;
}

/**
 * The NFL week a recap should cover, given the live week.
 *
 * Sleeper advances `week` on the Tuesday morning after a slate ends, but not
 * reliably at the same hour, and a recap posted on Tuesday is always about the
 * games that just finished. So the answer is derived from the last week our own
 * matchup rows mark final rather than from arithmetic on the live week, and
 * this only supplies the fallback for a league with nothing final yet.
 */
export function fallbackRecapWeek(currentWeek: number): number {
  return Math.max(1, currentWeek - 1);
}
