/**
 * Which NFL week is the live one, decided by the kickoff calendar.
 *
 * THE RULE. Week N is the current week until the end of the Eastern calendar
 * day of its LAST kickoff, which in a normal week is 11:59 PM Eastern on the
 * Monday night game. Only then does week N + 1 take over. A Thursday game, a
 * Saturday game or a finished Sunday slate never moves the week.
 *
 * WHY A CALENDAR AND NOT PLAYED GAMES. The first version of the site clock
 * (lib/start-sit/clock.ts) called a week over the moment any player had a
 * completed game in it. That is true only for the Monday game. Thursday night
 * puts box scores for two teams into player_stats, and from then until Tuesday
 * every page on that clock described the NEXT week: the waiver wire, the
 * start/sit board, the breakdown extras. Kickoff times answer the question
 * directly, and `nfl_game_odds` holds one for every game of the season.
 *
 * Pure except for `loadLastKickoffByWeek`, which is the one read.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SITE_TIME_ZONE } from "@/lib/datetime";
import { ODDS_SOURCE_SLUG } from "@/lib/nfl-game-environment";

/** Sleeper publishes an 18-week regular season. */
export const REGULAR_SEASON_WEEKS = 18;

const easternDateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsOf(ms: number): { y: number; m: number; d: number; hour: number; minute: number } {
  const parts = easternDateParts.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), hour: get("hour"), minute: get("minute") };
}

/**
 * The instant Eastern midnight begins on a calendar date. Eastern is UTC-4 in
 * daylight time and UTC-5 in standard time, and the clocks change at 2 AM, so
 * midnight itself is never ambiguous: whichever offset reads back as 00:00 on
 * that date is the right one.
 */
function easternMidnightMs(y: number, m: number, d: number): number {
  for (const offsetHours of [4, 5]) {
    const candidate = Date.UTC(y, m - 1, d, offsetHours);
    const p = partsOf(candidate);
    if (p.y === y && p.m === m && p.d === d && p.hour === 0 && p.minute === 0) return candidate;
  }
  // Unreachable for America/New_York; standard time is the safer guess.
  return Date.UTC(y, m - 1, d, 5);
}

/**
 * When a week stops being the current one: the first instant of the Eastern
 * calendar day AFTER its last kickoff. For a Monday night game at 8:15 PM that
 * is Tuesday 12:00 AM, so the week is live through Monday 11:59 PM Eastern.
 * Null for an unreadable timestamp.
 */
export function weekRolloverMs(lastKickoffIso: string): number | null {
  const kickoff = Date.parse(lastKickoffIso);
  if (!Number.isFinite(kickoff)) return null;
  const { y, m, d } = partsOf(kickoff);
  // Date.UTC normalises day 32 into the next month, and the day after is
  // always the same Eastern date whichever offset is in force.
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return easternMidnightMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/**
 * The live week at `nowMs`: the earliest week whose rollover has not passed.
 * Once every known week has rolled over, the week after the last one (19 at the
 * end of the regular season, the same "everything is played" value the site
 * clock has always used). Null when the calendar holds no usable kickoffs, so
 * the caller can fall back rather than guess.
 */
export function liveWeekFromKickoffs(
  lastKickoffByWeek: ReadonlyMap<number, string>,
  nowMs: number,
): number | null {
  const weeks = [...lastKickoffByWeek.keys()]
    .filter((w) => Number.isInteger(w) && w >= 1 && w <= REGULAR_SEASON_WEEKS)
    .sort((a, b) => a - b);
  if (weeks.length === 0) return null;
  // Walk from week 1 and stop at the first hole. A week with no usable kickoff
  // is a week we cannot say has ended, and skipping it would jump the site a
  // week early, which is the exact bug this module exists to prevent. The
  // caller falls back to Sleeper instead.
  for (let week = 1; week <= REGULAR_SEASON_WEEKS; week += 1) {
    const kickoff = lastKickoffByWeek.get(week);
    const rollover = kickoff ? weekRolloverMs(kickoff) : null;
    if (rollover === null) {
      return week > weeks[weeks.length - 1] ? week : null;
    }
    if (nowMs < rollover) return week;
  }
  return REGULAR_SEASON_WEEKS + 1;
}

/**
 * The latest kickoff of every regular-season week we hold, for one season.
 * Empty on any failure: a missing calendar is a reason to fall back, never an
 * error that stops a page rendering.
 */
export async function loadLastKickoffByWeek(
  supabase: SupabaseClient<Database>,
  season: number,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const { data, error } = await supabase
    .from("nfl_game_odds")
    .select("week, kickoff_at")
    .eq("season", season)
    .eq("season_type", "regular")
    .eq("source", ODDS_SOURCE_SLUG)
    .not("kickoff_at", "is", null);
  if (error || !data) return out;
  for (const row of data) {
    const week = Number(row.week);
    const kickoff = row.kickoff_at;
    if (!Number.isInteger(week) || !kickoff) continue;
    const prior = out.get(week);
    if (!prior || Date.parse(kickoff) > Date.parse(prior)) out.set(week, kickoff);
  }
  return out;
}
