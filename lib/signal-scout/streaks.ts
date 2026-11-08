/**
 * Signal Scout streak math: pure functions, zero I/O.
 *
 * Two independent streaks (plan.md section 6):
 * - Signal Streak: consecutive won rounds. Any non-win outcome (solved late,
 *   failed, skipped) resets it to 0, even though those outcomes still count
 *   as a round played. Hints never touch it; it is not an input here.
 * - Daily Scout Streak: consecutive ET calendar days with at least one
 *   completed round of any outcome. A second round on the same ET day does
 *   not double-increment; a gap resets it to 1.
 *
 * Day math lives in lib/game-date.ts. It works on
 * plain YYYY-MM-DD strings and never touches a local timezone: each date
 * string is parsed as UTC noon, then diffed by exactly 86,400,000 ms. Noon
 * avoids ever landing on a DST transition instant, and diffing whole UTC
 * days is immune to the fact that a real America/New_York calendar day can
 * be 23, 24, or 25 hours long around a DST change. Date.UTC itself already
 * accounts for month lengths and leap years, so no separate leap-year
 * handling is needed.
 */

import { currentEasternGameDate, isConsecutiveDay } from "@/lib/game-date";

// Moved to lib/game-date.ts (shared with Long Shot); re-exported so the
// existing importers do not change.
export { currentEasternGameDate, isConsecutiveDay };

export type RoundOutcome = "won" | "solved_late" | "failed" | "skipped";

export interface StreakState {
  currentSignalStreak: number;
  bestSignalStreak: number;
  currentDailyStreak: number;
  bestDailyStreak: number;
  lastPlayedDate: string | null;
}

export interface ApplyRoundOutcomeInput {
  outcome: RoundOutcome;
  /** YYYY-MM-DD, the ET calendar day the round completed on. */
  gameDate: string;
  current: StreakState;
}

/**
 * Apply a completed round's outcome to the five streak fields on
 * signal_scout_user_stats. Returns the updated state; callers persist it.
 */
export function applyRoundOutcomeToStreaks(input: ApplyRoundOutcomeInput): StreakState {
  const { outcome, gameDate, current } = input;

  const currentSignalStreak = outcome === "won" ? current.currentSignalStreak + 1 : 0;
  const bestSignalStreak = Math.max(current.bestSignalStreak, currentSignalStreak);

  let currentDailyStreak: number;
  if (current.lastPlayedDate === gameDate) {
    currentDailyStreak = current.currentDailyStreak;
  } else if (current.lastPlayedDate !== null && isConsecutiveDay(current.lastPlayedDate, gameDate)) {
    currentDailyStreak = current.currentDailyStreak + 1;
  } else {
    currentDailyStreak = 1;
  }
  const bestDailyStreak = Math.max(current.bestDailyStreak, currentDailyStreak);

  return {
    currentSignalStreak,
    bestSignalStreak,
    currentDailyStreak,
    bestDailyStreak,
    lastPlayedDate: gameDate,
  };
}
