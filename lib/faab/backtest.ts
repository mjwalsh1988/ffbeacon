/**
 * Does the model recommend numbers that would actually have won?
 *
 * WHAT THIS CAN AND CANNOT DO, STATED UP FRONT
 *   A true replay would rebuild each roster as it stood the morning of the
 *   claim, run the swap, and compare our number to the winning bid. We cannot
 *   do that: `rosters` holds current state only, so the roster composition on
 *   week 6 of 2024 is gone. Approximating it with a generic replacement level
 *   would reintroduce exactly the assumption this whole rewrite removed, and a
 *   backtest built on a fiction is worse than no backtest, because it produces
 *   a number people trust.
 *
 *   What IS recoverable is every winning bid this league has ever paid, from
 *   the preserved transaction records. So this measures CALIBRATION: across a
 *   whole league's history, does the price curve the model produces land in the
 *   same place as the prices the league actually pays? A model that recommends
 *   4 in a room where useful players go for 25 is broken, and this catches it
 *   without pretending to know more than it does.
 *
 * Pure. The caller loads the bids and passes the settings.
 */

import { percentile } from "./market";
import type { FaabSettings } from "./types";

export type LeagueBidSample = {
  sleeperLeagueId: string;
  leagueName: string;
  season: number;
  /** The league's per-team FAAB allowance. */
  totalBudget: number | null;
  /** Winning bids above zero. */
  bids: number[];
};

export type CalibrationRow = {
  sleeperLeagueId: string;
  leagueName: string;
  season: number;
  sampleSize: number;
  totalBudget: number | null;
  /** What the league actually paid. */
  observed: { p25: number; median: number; p75: number; max: number };
  /** What the model would recommend at the matching upgrade strengths. */
  modelled: { p25: number; median: number; p75: number; max: number };
  /**
   * Median model bid over median observed bid. 1.0 is perfectly calibrated,
   * 0.5 means the model is recommending half what the room pays.
   */
  medianRatio: number | null;
  verdict: "calibrated" | "under" | "over" | "insufficient";
};

export type CalibrationSummary = {
  leagues: CalibrationRow[];
  /** Leagues with enough history to grade. */
  graded: number;
  /** Median of the per-league median ratios. */
  medianRatio: number | null;
  /** How many leagues land inside the acceptable band. */
  calibrated: number;
  under: number;
  over: number;
};

/** Ratios inside this band count as calibrated. Wide on purpose: FAAB rooms are
 * genuinely different from each other and a model that matched every league
 * exactly would be overfit to noise. */
const LOWER_BAND = 0.6;
const UPPER_BAND = 1.6;

/**
 * The model's price at a given upgrade strength, ignoring market adjustments.
 *
 * Market adjustments are per-claim and unknowable historically (who had money
 * that week, who else wanted him), so calibration is measured against the value
 * curve alone. That is the part of the model this test can actually hold to
 * account.
 */
export function modelPriceAt(
  upgradeStrength: number,
  budget: number,
  settings: FaabSettings,
): number {
  const pct = Math.min(
    100,
    Math.max(0, upgradeStrength * settings.marginal.maxPctFromUpgrade),
  );
  return Math.round((pct / 100) * budget);
}

/**
 * Grade one league season.
 *
 * The pairing is by rank, not by claim: we take the observed bid distribution
 * and the model's own price curve, and check whether the same quantiles line
 * up. A league whose 75th-percentile claim costs 30 should be a league where
 * the model's 75th-percentile recommendation is somewhere near 30.
 */
export function calibrateLeague(
  sample: LeagueBidSample,
  settings: FaabSettings,
  minSamples: number,
): CalibrationRow {
  const bids = sample.bids.filter((b) => Number.isFinite(b) && b > 0).sort((a, b) => a - b);
  const budget = sample.totalBudget ?? 100;

  const observed = {
    p25: percentile(bids, 0.25),
    median: percentile(bids, 0.5),
    p75: percentile(bids, 0.75),
    max: bids.length > 0 ? bids[bids.length - 1] : 0,
  };

  // The model's own curve sampled at the matching quantiles. Upgrade strength is
  // uniform on 0..1 by construction here: we are asking what range of numbers
  // the model is capable of producing, not what it said about any one player.
  const modelled = {
    p25: modelPriceAt(0.25, budget, settings),
    median: modelPriceAt(0.5, budget, settings),
    p75: modelPriceAt(0.75, budget, settings),
    max: modelPriceAt(1, budget, settings),
  };

  if (bids.length < minSamples) {
    return {
      sleeperLeagueId: sample.sleeperLeagueId,
      leagueName: sample.leagueName,
      season: sample.season,
      sampleSize: bids.length,
      totalBudget: sample.totalBudget,
      observed,
      modelled,
      medianRatio: null,
      verdict: "insufficient",
    };
  }

  const medianRatio = observed.median > 0 ? modelled.median / observed.median : null;
  const verdict: CalibrationRow["verdict"] =
    medianRatio === null
      ? "insufficient"
      : medianRatio < LOWER_BAND
        ? "under"
        : medianRatio > UPPER_BAND
          ? "over"
          : "calibrated";

  return {
    sleeperLeagueId: sample.sleeperLeagueId,
    leagueName: sample.leagueName,
    season: sample.season,
    sampleSize: bids.length,
    totalBudget: sample.totalBudget,
    observed,
    modelled,
    medianRatio,
    verdict,
  };
}

export function summarizeCalibration(rows: CalibrationRow[]): CalibrationSummary {
  const graded = rows.filter((r) => r.verdict !== "insufficient");
  const ratios = graded
    .map((r) => r.medianRatio)
    .filter((r): r is number => r !== null)
    .sort((a, b) => a - b);

  const mid = Math.floor(ratios.length / 2);
  const medianRatio =
    ratios.length === 0
      ? null
      : ratios.length % 2 === 0
        ? (ratios[mid - 1] + ratios[mid]) / 2
        : ratios[mid];

  return {
    leagues: rows,
    graded: graded.length,
    medianRatio,
    calibrated: graded.filter((r) => r.verdict === "calibrated").length,
    under: graded.filter((r) => r.verdict === "under").length,
    over: graded.filter((r) => r.verdict === "over").length,
  };
}
