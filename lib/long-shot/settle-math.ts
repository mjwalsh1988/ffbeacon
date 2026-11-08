/**
 * The pure half of settlement (plan 10.3).
 *
 * Lone Signal: only when the puzzle has at least bonus.min_room completed
 * Hurry-Up attempts. A correct answer whose tally share of the prompt's
 * answered_total is under bonus.lone_share earns bonus.points. Abandoned
 * attempts earn nothing. The orchestrator in settle.ts applies the result
 * through one guarded update per attempt, so a rerun pays nobody twice.
 */

import type { LongShotSettings } from "./types";

export interface SettleAnswer {
  id: string;
  prompt_id: string;
  player_id: string | null;
  correct: boolean | null;
}

export type Tallies = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** The ids of the answers that qualify for Lone Signal. */
export function loneSignals(
  answers: readonly SettleAnswer[],
  tallies: Tallies,
  answeredTotal: ReadonlyMap<string, number>,
  settings: Pick<LongShotSettings, "bonus">,
  roomSize: number,
): string[] {
  if (roomSize < settings.bonus.min_room) return [];
  const out: string[] = [];
  for (const a of answers) {
    if (!a.correct || !a.player_id) continue;
    const total = answeredTotal.get(a.prompt_id) ?? 0;
    if (total <= 0) continue;
    const count = tallies.get(a.prompt_id)?.get(a.player_id) ?? 0;
    if (count / total < settings.bonus.lone_share) out.push(a.id);
  }
  return out;
}

export interface AttemptSettlement {
  attemptId: string;
  userId: string;
  bonusPoints: number;
  loneAnswerIds: string[];
}

/** One settlement per attempt. Abandoned attempts always settle at 0. */
export function planSettlement(
  attempts: ReadonlyArray<{ id: string; user_id: string; status: string; answers: SettleAnswer[] }>,
  tallies: Tallies,
  answeredTotal: ReadonlyMap<string, number>,
  settings: Pick<LongShotSettings, "bonus">,
): AttemptSettlement[] {
  const roomSize = attempts.filter((a) => a.status === "completed").length;
  return attempts.map((a) => {
    const lone =
      a.status === "completed" ? loneSignals(a.answers, tallies, answeredTotal, settings, roomSize) : [];
    return {
      attemptId: a.id,
      userId: a.user_id,
      bonusPoints: lone.length * settings.bonus.points,
      loneAnswerIds: lone,
    };
  });
}

/** Users whose streak the reset zeroes: a positive streak last extended before the target. */
export function streakResetUsers(
  stats: ReadonlyArray<{ user_id: string; current_streak: number; last_completed_date: string | null }>,
  target: string,
): string[] {
  return stats
    .filter((s) => s.current_streak > 0 && s.last_completed_date !== null && s.last_completed_date < target)
    .map((s) => s.user_id);
}
