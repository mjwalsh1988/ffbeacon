/**
 * Age by position (plan 6.4). Pure.
 *
 * Value-weighted mean decimal age of this roster's PRICED players at each of
 * QB, RB, WR and TE, beside the same figure across every roster in the league.
 * Value weighting is the point: a 31-year-old backup worth 200 should not age a
 * roster the way a 31-year-old starter worth 6,000 does. Unpriced players
 * (defenders, specialists, anyone with no value row) and players with no birth
 * date carry no weight. A position with no priced player is null.
 */

import { BLUEPRINT_POSITIONS } from "./default-settings";
import type { AgeRow, BlueprintAge } from "./types";

export type AgePlayer = { position: string; value: number | null; age: number | null };

const round1 = (v: number) => Math.round(v * 10) / 10;

function weightedMean(players: readonly AgePlayer[]): { mean: number | null; count: number } {
  let sum = 0;
  let weight = 0;
  let count = 0;
  for (const p of players) {
    if (p.value === null || p.value <= 0 || p.age === null) continue;
    sum += p.age * p.value;
    weight += p.value;
    count += 1;
  }
  return { mean: weight > 0 ? sum / weight : null, count };
}

export function computeAge(
  mine: readonly AgePlayer[],
  league: readonly AgePlayer[],
  youngAge: number,
): BlueprintAge {
  const offense = (list: readonly AgePlayer[]) =>
    list.filter((p) => (BLUEPRINT_POSITIONS as readonly string[]).includes(p.position));
  const rows: AgeRow[] = BLUEPRINT_POSITIONS.map((position) => {
    const m = weightedMean(mine.filter((p) => p.position === position));
    const l = weightedMean(league.filter((p) => p.position === position));
    return {
      position,
      mine: m.mean === null ? null : round1(m.mean),
      league: l.mean === null ? null : round1(l.mean),
      gap: m.mean === null || l.mean === null ? null : round1(l.mean - m.mean),
      count: m.count,
    };
  });
  const rm = weightedMean(offense(mine)).mean;
  const lm = weightedMean(offense(league)).mean;

  let young = 0;
  let total = 0;
  for (const p of offense(mine)) {
    if (p.value === null || p.value <= 0 || p.age === null) continue;
    total += p.value;
    if (p.age <= youngAge) young += p.value;
  }
  return {
    rows,
    rosterMean: rm === null ? null : round1(rm),
    leagueMean: lm === null ? null : round1(lm),
    gap: rm === null || lm === null ? null : round1(lm - rm),
    youngCoreShare: total > 0 ? young / total : null,
  };
}
