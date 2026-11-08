/**
 * Game-date labels, in America/New_York per the site's time display rule. A
 * game date is a calendar day, so it is formatted at UTC noon, which is the
 * same calendar day in Eastern all year.
 */

import { SITE_TIME_ZONE } from "@/lib/datetime";

const LONG_DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: SITE_TIME_ZONE,
});

const SHORT_DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: SITE_TIME_ZONE,
});

const atNoon = (gameDate: string) => new Date(`${gameDate}T12:00:00Z`);

/** "Saturday, November 7" */
export function longDayLabel(gameDate: string): string {
  return LONG_DAY.format(atNoon(gameDate));
}

/** "Puzzle for Saturday, November 7" */
export function puzzleDateLabel(gameDate: string): string {
  return `Puzzle for ${longDayLabel(gameDate)}`;
}

/** "Sat" */
export function shortWeekday(gameDate: string): string {
  return SHORT_DAY.format(atNoon(gameDate));
}
