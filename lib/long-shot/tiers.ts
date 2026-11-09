/**
 * Tiering an answer set by roster rate (plan 7.5 and 31.4). Pure.
 *
 * BANDS FIRST. Each answer takes the tier of the absolute band its rate falls
 * in (settings.tiers.bands): under 2 percent of our redraft leagues is a Long
 * Shot, 60 percent and over is Chalk. A player rostered everywhere can never
 * be a Long Shot however elite the company he keeps on the prompt.
 *
 * ONE-BAND SETS SPREAD. When every answer lands in the same band, the set is
 * spread by within-set percentile (settings.tiers.cutoffs) across that band's
 * tier and the next two rarer tiers, so a top-50 board still rewards the
 * least-rostered of the fifty, with Deep as the ceiling.
 *
 * Within a spread, sorted by rate ascending (then player id, for a stable
 * order); entry i of n sits at p = i / n, and every tie on rate takes the p of
 * the FIRST entry with that rate, so equal rates always get equal tiers.
 *
 * A historical answer's "rate" is its prominence (lib/long-shot/history/
 * prominence.ts), read through the same bands. Tiers are frozen on the prompt
 * row; a later settings change alters tomorrow's puzzle, never today's.
 */

import { TIERS, type AnswerEntry, type Tier, type TierCutoffs } from "./types";

export function tierForShare(p: number, cutoffs: TierCutoffs): Tier {
  if (p < cutoffs.long_shot) return "long_shot";
  if (p < cutoffs.sleeper) return "sleeper";
  if (p < cutoffs.deep) return "deep";
  if (p < cutoffs.field) return "field";
  return "chalk";
}

/** The percentile spread (the original method), over the whole tier ladder. */
export function assignTiers(
  entries: ReadonlyArray<{ player_id: string; rate: number }>,
  cutoffs: TierCutoffs,
): AnswerEntry[] {
  return spread(entries, cutoffs, TIERS);
}

function sortByRate<T extends { player_id: string; rate: number }>(entries: readonly T[]): T[] {
  return entries
    .slice()
    .sort((a, b) => a.rate - b.rate || (a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0));
}

/**
 * Percentile spread restricted to a ladder of tiers (lowest to highest). The
 * five-tier cutoffs are mapped onto the ladder by evenly dividing [0, 1).
 */
function spread(
  entries: ReadonlyArray<{ player_id: string; rate: number }>,
  cutoffs: TierCutoffs,
  ladder: readonly Tier[],
): AnswerEntry[] {
  const sorted = sortByRate(entries);
  const n = sorted.length;
  const out: AnswerEntry[] = [];
  let firstIndexOfRate = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && sorted[i].rate !== sorted[i - 1].rate) firstIndexOfRate = i;
    const p = firstIndexOfRate / n;
    const tier =
      ladder.length === TIERS.length
        ? tierForShare(p, cutoffs)
        : // Rarest tier at the lowest p, so the ladder is read from its end.
          ladder[ladder.length - 1 - Math.min(ladder.length - 1, Math.floor(p * ladder.length))];
    out.push({ player_id: sorted[i].player_id, rate: sorted[i].rate, tier });
  }
  return out;
}

/** Bands first, then the one-band spread. */
export function assignTiersBanded(
  entries: ReadonlyArray<{ player_id: string; rate: number }>,
  bands: TierCutoffs,
  cutoffs: TierCutoffs,
): AnswerEntry[] {
  if (entries.length === 0) return [];
  const banded = entries.map((e) => tierForShare(e.rate, bands));
  const distinct = new Set(banded);
  if (distinct.size > 1) {
    return sortByRate(entries.map((e, i) => ({ player_id: e.player_id, rate: e.rate, tier: banded[i] })));
  }
  const base = TIERS.indexOf(banded[0]);
  const ladder = TIERS.slice(base, Math.min(TIERS.length, base + 3));
  return spread(entries, cutoffs, ladder);
}

export function pointsFor(tier: Tier | null, points: Record<Tier, number>): number {
  return tier ? points[tier] : 0;
}
