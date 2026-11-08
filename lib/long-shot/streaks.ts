/**
 * Long Shot streaks (plan 12). Pure. Hurry-Up only; Film Room never reaches
 * this module (lib/long-shot/film-room-guard.test.ts).
 *
 * The settle cron zeroes current_streak for everyone who missed a settled
 * date, so the stored value is right from 00:30 Eastern. displayedStreak
 * covers the hours between a missed day's end and that cron.
 */

import { addDays, isConsecutiveDay } from "@/lib/game-date";

export interface StreakState {
  last_completed_date: string | null;
  current_streak: number;
  best_streak: number;
}

export function applyCompletion(prev: StreakState, gameDate: string): StreakState {
  let current: number;
  if (prev.last_completed_date === null) current = 1;
  else if (prev.last_completed_date === gameDate) current = Math.max(1, prev.current_streak);
  else if (isConsecutiveDay(prev.last_completed_date, gameDate)) current = prev.current_streak + 1;
  else current = 1;
  return {
    last_completed_date: gameDate,
    current_streak: current,
    best_streak: Math.max(prev.best_streak, current),
  };
}

export function displayedStreak(
  stats: { last_completed_date: string | null; current_streak: number } | null,
  today: string,
): number {
  if (!stats?.last_completed_date) return 0;
  const d = stats.last_completed_date;
  return d === today || d === addDays(today, -1) ? stats.current_streak : 0;
}
