/**
 * The season behind one week: how every week has gone, and how the week on
 * screen fits into it.
 *
 * TWO SERIES, AND THEY ANSWER DIFFERENT QUESTIONS.
 *
 *   SCORED against BEST POSSIBLE   what the roster produced against what it
 *                                  could have produced. The gap is a decision.
 *   PROJECTED against SCORED       what the model expected against what
 *                                  happened. The gap is variance, or a model
 *                                  being wrong, and it is nobody's fault.
 *
 * Putting them on one chart would invite a reader to read one gap as the other,
 * which is the single most common way a fantasy "efficiency" number gets
 * misused. They are drawn as two.
 *
 * EVERY SETTLED FIGURE IS THE MANAGER LEDGER'S, READ AND NOT RECOMPUTED.
 * `officialPoints`, `pointsLeft`, `setPoints`, `optimalPoints`, the result and
 * the best-lineup result all come out of `league_manager_ledger_cache`, which
 * is the model that owns "how did this manager do" (lib/manager-ledger/, the
 * Decisions page). A second implementation here would drift from it, and the
 * two pages would disagree about the same week with nothing to say which was
 * right. This module merges, orders and fills gaps; it grades nothing.
 *
 * THE PROJECTION SERIES IS OURS, because the ledger has none by construction:
 * CLAUDE.md's rule for it is that every figure is retrospective and settled,
 * and a projection is neither. See ./season-data.ts for where those totals come
 * from and what they can and cannot claim.
 *
 * PURE. Plain data in, plain data out.
 */

import type { LedgerOutcome, LedgerWeek } from "@/lib/manager-ledger/types";

/** One week of the season, from whichever sources hold something about it. */
export type SeasonWeekPoint = {
  week: number;
  /** Sleeper's official total. Null for a week that has not settled. */
  scored: number | null;
  /**
   * What the best legal lineup would have scored, on the same official basis.
   * Null alongside `scored`.
   */
  bestPossible: number | null;
  /** Points that stayed on the bench. Null alongside `scored`. */
  leftOnBench: number | null;
  /**
   * Set points over optimal points, both restricted to gradable slots.
   *
   * NOT `scored / bestPossible`. Those two include the slots the optimiser
   * cannot touch (IDP), which adds the same constant to both halves and pulls
   * the ratio toward 1, flattering every manager in an IDP league. The ledger
   * stores the gradable-only pair for exactly this reason.
   */
  efficiency: number | null;
  /**
   * The gradable-only pair behind `efficiency`, carried so a caller can roll
   * several weeks into one ratio without falling back to the official basis.
   *
   * Summing `scored` over `bestPossible` across a season is the same mistake
   * `efficiency` avoids per week: the ungradable slots add the same constant to
   * both halves and pull the ratio toward 1. Null on a row written before
   * ledger-4 stored them.
   */
  setPoints: number | null;
  optimalPoints: number | null;
  /** What the set lineup was projected to score that week. Null when unknown. */
  projected: number | null;
  outcome: LedgerOutcome | null;
  bestOutcome: LedgerOutcome | null;
  /** True when this is the week the page is currently showing. */
  isViewed: boolean;
};

export type SeasonSeries = {
  points: SeasonWeekPoint[];
  /** Weeks that carry a settled score. */
  settledCount: number;
  /** Weeks that carry a projection, settled or not. */
  projectedCount: number;
  /** True when at least one settled week also carries a projection. */
  hasComparison: boolean;
  /** The highest points figure across every series, for a shared y axis. */
  maxPoints: number;
};

/**
 * Merge what the ledger knows with what we projected, one row per week.
 *
 * A week appears when EITHER side holds something for it, so the chart shows a
 * projection for weeks still to come and a result for weeks already played,
 * rather than stopping at whichever source ran out first.
 */
export function buildSeasonSeries(input: {
  /** Settled weeks, from `league_manager_ledger_cache.weeks`. */
  ledgerWeeks: LedgerWeek[];
  /** Projected total for the set lineup, by week. */
  projectedByWeek: Map<number, number>;
  /** The week the page is showing, so the chart can mark it. */
  viewedWeek: number;
}): SeasonSeries {
  const { ledgerWeeks, projectedByWeek, viewedWeek } = input;

  const byWeek = new Map<number, SeasonWeekPoint>();

  for (const w of ledgerWeeks) {
    const week = Number(w.week);
    if (!Number.isFinite(week)) continue;
    const official = numberOrNull(w.officialPoints);
    const left = numberOrNull(w.pointsLeft);
    const setPoints = numberOrNull(w.setPoints);
    const optimalPoints = numberOrNull(w.optimalPoints);

    byWeek.set(week, {
      week,
      scored: official,
      bestPossible: official === null || left === null ? null : round2(official + left),
      leftOnBench: left,
      // A row written before the ledger stored these carries neither, and an
      // absent efficiency is honest where a derived one would not be.
      efficiency:
        setPoints === null || optimalPoints === null || optimalPoints <= 0
          ? null
          : Math.min(1, Math.round((setPoints / optimalPoints) * 10000) / 10000),
      setPoints,
      optimalPoints,
      projected: null,
      outcome: w.outcome ?? null,
      bestOutcome: w.bestLineupOutcome ?? null,
      isViewed: week === viewedWeek,
    });
  }

  for (const [week, projected] of projectedByWeek) {
    if (!Number.isFinite(week) || !Number.isFinite(projected)) continue;
    const existing = byWeek.get(week);
    if (existing) {
      existing.projected = round2(projected);
      continue;
    }
    byWeek.set(week, {
      week,
      scored: null,
      bestPossible: null,
      leftOnBench: null,
      efficiency: null,
      setPoints: null,
      optimalPoints: null,
      projected: round2(projected),
      outcome: null,
      bestOutcome: null,
      isViewed: week === viewedWeek,
    });
  }

  const points = [...byWeek.values()].sort((a, b) => a.week - b.week);

  let maxPoints = 0;
  let settledCount = 0;
  let projectedCount = 0;
  let hasComparison = false;
  for (const p of points) {
    if (p.scored !== null) settledCount += 1;
    if (p.projected !== null) projectedCount += 1;
    if (p.scored !== null && p.projected !== null) hasComparison = true;
    for (const value of [p.scored, p.bestPossible, p.projected]) {
      if (value !== null && value > maxPoints) maxPoints = value;
    }
  }

  return { points, settledCount, projectedCount, hasComparison, maxPoints };
}

/**
 * How the projection did across the settled weeks: the average miss, and how
 * often it was too low.
 *
 * SIGNED, because the direction is the finding. A model that is 12 points out
 * in both directions and a model that is 12 points low every week are the same
 * average absolute error and completely different problems.
 */
export type ProjectionAccuracy = {
  weeks: number;
  /** Mean of (scored minus projected). Positive means the model ran low. */
  meanDiff: number;
  /** Mean of the absolute miss, so a symmetric model does not read as perfect. */
  meanAbsDiff: number;
  /** Weeks the lineup beat its projection. */
  beatWeeks: number;
};

export function projectionAccuracy(points: SeasonWeekPoint[]): ProjectionAccuracy | null {
  const pairs = points.filter(
    (p): p is SeasonWeekPoint & { scored: number; projected: number } =>
      p.scored !== null && p.projected !== null,
  );
  if (pairs.length === 0) return null;

  let diff = 0;
  let abs = 0;
  let beat = 0;
  for (const p of pairs) {
    const d = p.scored - p.projected;
    diff += d;
    abs += Math.abs(d);
    if (d > 0) beat += 1;
  }
  return {
    weeks: pairs.length,
    meanDiff: round2(diff / pairs.length),
    meanAbsDiff: round2(abs / pairs.length),
    beatWeeks: beat,
  };
}

/**
 * Several weeks rolled into one efficiency, on the gradable basis.
 *
 * The only correct way to aggregate this. A mean of the per-week ratios would
 * weight a 70 point bye week the same as a 140 point one, and summing `scored`
 * over `bestPossible` reintroduces the ungradable slots the per-week figure was
 * built to exclude. Null when no week carries the pair, which is every week of
 * a league whose ledger row predates ledger-4.
 */
export function rollUpEfficiency(points: SeasonWeekPoint[]): number | null {
  let set = 0;
  let optimal = 0;
  let counted = 0;
  for (const p of points) {
    if (p.setPoints === null || p.optimalPoints === null) continue;
    set += p.setPoints;
    optimal += p.optimalPoints;
    counted += 1;
  }
  if (counted === 0 || optimal <= 0) return null;
  return Math.min(1, Math.round((set / optimal) * 10000) / 10000);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
