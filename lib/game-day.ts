/**
 * Is this game being played right now, as far as the page can tell?
 *
 * Pure and clock-free: the caller passes `now`, so a test can pin any moment
 * and the answer is the same on a UTC server and in a Hawaii browser.
 *
 * WHY IT IS A DAY AND NOT A KICKOFF TIME. The honest signal available here is
 * "the game is today and we hold no stat line yet". We do not poll a live feed,
 * and `player_stats` lands after the sync runs rather than as the game unfolds,
 * so a minute-accurate "in progress" would be a claim the data cannot support.
 * A game day with no line is a true statement all day and stops being true the
 * moment the stats arrive, which is exactly the state a reader wants marked.
 *
 * THE DAY IS EASTERN, like every other date on this site. A Sunday one o'clock
 * kickoff is on Sunday for everybody, including a reader in Auckland for whom
 * it is already Monday, and including the UTC server for whom a Sunday night
 * game has already rolled into Monday.
 */

import { SITE_TIME_ZONE } from "@/lib/datetime";

/** The calendar date in Eastern, as "YYYY-MM-DD", for comparison only. */
export function easternDateKey(value: Date | string | number): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // en-CA formats as YYYY-MM-DD, which sorts and compares as a plain string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SITE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** True when the kickoff falls on the same Eastern calendar day as `now`. */
export function isGameDay(
  kickoffAt: string | null | undefined,
  now: Date | number,
): boolean {
  if (!kickoffAt) return false;
  const game = easternDateKey(kickoffAt);
  if (!game) return false;
  return game === easternDateKey(now);
}

/** What a week's row in a game log is showing. */
export type WeekRowState =
  /** A stat line exists. The row renders numbers. */
  | "played"
  /** Kicks off today and nothing has landed. The row renders a live marker. */
  | "in-progress"
  /** No line, and the game is not today. The row renders placeholders. */
  | "upcoming";

/**
 * Which of the three a week is in.
 *
 * A stat line always wins. A game that kicked off this morning and has already
 * been synced is "played", not "in progress", because the numbers are the
 * better answer and a spinner over real figures would be a lie about them.
 */
export function weekRowState(params: {
  hasStats: boolean;
  kickoffAt: string | null | undefined;
  now: Date | number;
}): WeekRowState {
  if (params.hasStats) return "played";
  return isGameDay(params.kickoffAt, params.now) ? "in-progress" : "upcoming";
}
