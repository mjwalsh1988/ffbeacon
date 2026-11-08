/**
 * Tiering an answer set by roster rate (plan 7.5). Pure.
 *
 * Sorted by rate ascending (then player id, for a stable order); entry i of n
 * sits at p = i / n, and every tie on rate takes the p of the FIRST entry with
 * that rate, so equal rates always get equal tiers. Players nobody rosters
 * (rate 0) therefore all land in long_shot, however many there are: the
 * question is who rosters him today, and nobody does.
 *
 * Tiers are frozen on the prompt row. A later settings change alters
 * tomorrow's puzzle, never today's.
 */

import type { AnswerEntry, Tier, TierCutoffs } from "./types";

export function tierForShare(p: number, cutoffs: TierCutoffs): Tier {
  if (p < cutoffs.long_shot) return "long_shot";
  if (p < cutoffs.sleeper) return "sleeper";
  if (p < cutoffs.deep) return "deep";
  if (p < cutoffs.field) return "field";
  return "chalk";
}

export function assignTiers(
  entries: ReadonlyArray<{ player_id: string; rate: number }>,
  cutoffs: TierCutoffs,
): AnswerEntry[] {
  const sorted = entries
    .slice()
    .sort((a, b) => a.rate - b.rate || (a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0));
  const n = sorted.length;
  const out: AnswerEntry[] = [];
  let firstIndexOfRate = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && sorted[i].rate !== sorted[i - 1].rate) firstIndexOfRate = i;
    const p = firstIndexOfRate / n;
    out.push({ player_id: sorted[i].player_id, rate: sorted[i].rate, tier: tierForShare(p, cutoffs) });
  }
  return out;
}

export function pointsFor(tier: Tier | null, points: Record<Tier, number>): number {
  return tier ? points[tier] : 0;
}
