/**
 * When the Discord poll goes out.
 *
 * THE CRON IS THE TICK. THE ADMIN PANEL IS THE SCHEDULE.
 *
 * `/api/cron/would-you-rather-discord` fires once an hour and does almost
 * nothing 21 hours a day. Whether a given tick actually posts is decided here,
 * against the hours an admin picked in America/New_York. Three hours picked is
 * three posts a day; one hour picked is one, even though the cron woke up 24
 * times. That is the whole reason the schedule does not live in vercel.json.
 *
 * IT HAS TO BE EASTERN, AND IT HAS TO BE RESOLVED RATHER THAN OFFSET. Vercel
 * schedules in UTC and the UTC-to-Eastern offset moves twice a year. A cron
 * expression pinned to 12:00 UTC is 8am for seven months and 7am for five, and
 * an admin who asked for 8am would never be told. Reading the hour through
 * Intl in America/New_York is right on both sides of the boundary and needs no
 * DST table.
 *
 * Pure and clock-free: every function takes the instant it should reason about.
 */

import { SITE_TIME_ZONE } from "@/lib/datetime";

/** The date and hour, in Eastern, of an instant. */
export interface EasternSlot {
  /** "2026-08-28" in Eastern. */
  date: string;
  /** 0 to 23, Eastern. */
  hour: number;
  /** "2026-08-28-14". The unique key a posted poll is recorded under. */
  key: string;
}

const SLOT_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/**
 * Which Eastern date and hour an instant falls in.
 *
 * en-CA with 2-digit parts gives ISO-ordered fields, and the parts are read by
 * type rather than by splitting the formatted string, so a locale data update
 * that changes the separator cannot silently move the date.
 */
export function easternSlot(at: Date): EasternSlot {
  const parts = SLOT_FORMAT.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // hourCycle h23 renders midnight as "24" in some ICU versions; fold it back.
  const rawHour = Number(get("hour"));
  const hour = Number.isFinite(rawHour) ? rawHour % 24 : 0;
  return { date, hour, key: `${date}-${String(hour).padStart(2, "0")}` };
}

/**
 * Should this tick post?
 *
 * Only the HOUR is compared. The cron fires on the hour, so an admin choosing
 * 8 means "the tick that wakes up during the 8am Eastern hour", and a tick that
 * arrives a couple of minutes late still counts. The slot key is what stops
 * that from becoming two posts: the second tick inside the same Eastern hour
 * collides on the unique key and writes nothing.
 */
export function isPostHour(at: Date, postHours: number[]): boolean {
  if (postHours.length === 0) return false;
  return postHours.includes(easternSlot(at).hour);
}

/** "8:00 AM", "3:00 PM". The label the admin panel puts beside each checkbox. */
export function describePostHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
}

/**
 * The whole schedule in one line, for the admin panel and the cron's own log.
 *
 * Says the frequency first because that is the thing an admin is actually
 * setting, then the times, so "once a day" and "three times a day" are legible
 * without counting commas.
 */
export function describeSchedule(postHours: number[]): string {
  if (postHours.length === 0) return "No times selected, so nothing will post.";
  const times = postHours.map(describePostHour).join(", ");
  const frequency =
    postHours.length === 1
      ? "Once a day"
      : postHours.length === 2
        ? "Twice a day"
        : `${postHours.length} times a day`;
  return `${frequency}, at ${times} Eastern.`;
}

/** When a poll opened now would close. */
export function pollClosesAt(at: Date, pollHours: number): Date {
  return new Date(at.getTime() + pollHours * 60 * 60 * 1000);
}

/**
 * How long to keep asking Discord for a closed poll's final numbers before
 * taking whatever it last reported.
 *
 * Discord marks a poll's results finalized some time after it expires rather
 * than at the instant it does, so an ingestion that insisted on the finalized
 * flag could wait forever on a poll Discord never gets round to sealing. Six
 * hours of hourly retries, then the counts are taken as they stand and the
 * poll is closed out. Taking them once is what matters; the guard against
 * double counting is results_ingested_at, not this.
 */
export const POLL_FINALIZE_GRACE_MS = 6 * 60 * 60 * 1000;

export function shouldIngestNow(
  at: Date,
  closesAt: Date,
  isFinalized: boolean,
): boolean {
  if (at.getTime() < closesAt.getTime()) return false;
  if (isFinalized) return true;
  return at.getTime() >= closesAt.getTime() + POLL_FINALIZE_GRACE_MS;
}
