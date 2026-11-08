/**
 * Scoring one answer against a prompt's frozen answer set (plan 9). Pure.
 *
 * base_points on an attempt is ALWAYS recomputed with sumPoints over its
 * answer rows, never incremented, so no path can double count.
 */

import { pointsFor } from "./tiers";
import type { AnswerEntry, Tier } from "./types";

export function scoreAnswer(
  answers: readonly AnswerEntry[],
  playerId: string | null,
  points: Record<Tier, number>,
): { correct: boolean; tier: Tier | null; points: number } {
  if (!playerId) return { correct: false, tier: null, points: 0 };
  const hit = answers.find((a) => a.player_id === playerId);
  if (!hit) return { correct: false, tier: null, points: 0 };
  return { correct: true, tier: hit.tier, points: pointsFor(hit.tier, points) };
}

export function sumPoints(rows: ReadonlyArray<{ points: number | null }>): number {
  return rows.reduce((acc, r) => acc + (r.points ?? 0), 0);
}
