/**
 * Share of the league (plan 6.5). Pure.
 *
 * Value share is this roster's total value over the league's; production
 * share is its points for over the league's, ranked by points for with ties
 * broken by roster id. Preseason (nobody has scored) production is null, and
 * the page says "No games scored yet." Percent to one decimal.
 */

import type { ShareFigure } from "./types";

export const NO_PRODUCTION = "No games scored yet.";

const pct1 = (v: number) => Math.round(v * 1000) / 10;

export function computeShares(
  rosters: ReadonlyArray<{ rosterId: number; totalValue: number | null; pointsFor: number }>,
  myRosterId: number,
  valueRank: number | null,
): { value: ShareFigure; production: ShareFigure } {
  const mine = rosters.find((r) => r.rosterId === myRosterId);
  const valueSum = rosters.reduce((s, r) => s + (r.totalValue ?? 0), 0);
  const pointsSum = rosters.reduce((s, r) => s + r.pointsFor, 0);

  const value: ShareFigure =
    mine && mine.totalValue !== null && valueSum > 0
      ? { pct: pct1(mine.totalValue / valueSum), rank: valueRank }
      : { pct: null, rank: null };

  if (!mine || pointsSum <= 0) return { value, production: { pct: null, rank: null } };
  const ordered = [...rosters].sort((a, b) => b.pointsFor - a.pointsFor || a.rosterId - b.rosterId);
  return {
    value,
    production: {
      pct: pct1(mine.pointsFor / pointsSum),
      rank: ordered.findIndex((r) => r.rosterId === myRosterId) + 1,
    },
  };
}
