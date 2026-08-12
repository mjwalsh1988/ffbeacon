/**
 * Signal Check confidence scoring.
 *
 * Deterministic 0..100 composite from interpretable factors, mapped to
 * low/medium/high by admin thresholds. Higher margin and clean inputs raise
 * confidence; picks (noisier valuations), missing values, slotless picks priced
 * by the season+round blend, and a material pile-on lower it. Auto-detected
 * Sleeper formats get a small boost. Admin rule confidence_modifiers are summed
 * in last.
 */

import type {
  ConfidenceFactor,
  ConfidenceLevel,
  ConfidenceResult,
  SignalCheckSettings,
} from "./types";

export interface ConfidenceInputs {
  marginRaw: number;
  pickCount: number;
  noValueCount: number;
  hasBlendedPicks: boolean;
  /** A pick's slot came from projected standings rather than from a user. */
  hasEstimatedPicks?: boolean;
  /** True only on the Sleeper path when format detection was clean. */
  formatAutoDetected: boolean;
  pileOnFired: boolean;
  /** A consolidation credit changed which side wins, or by how much. */
  consolidationApplied?: boolean;
  /** The balancing solver hit its ceiling, so the credit understates the gap. */
  consolidationCapped?: boolean;
  ruleModifiers: number[];
}

const BASE_SCORE = 60;

export function computeConfidence(
  inputs: ConfidenceInputs,
  settings: SignalCheckSettings,
): ConfidenceResult {
  if (!settings.confidenceEnabled) {
    return { enabled: false, level: null, label: null, score: 0, factors: [] };
  }

  const factors: ConfidenceFactor[] = [];
  const add = (key: string, contribution: number, note: string) => {
    factors.push({ key, contribution, note });
  };

  add("base", BASE_SCORE, "Baseline confidence");

  const marginContribution = Math.min(15, inputs.marginRaw * 0.75);
  add("margin", marginContribution, `Separation of ${inputs.marginRaw.toFixed(1)}%`);

  const pickPenalty = -Math.min(15, inputs.pickCount * 5);
  if (pickPenalty !== 0) add("picks", pickPenalty, `${inputs.pickCount} pick(s) add valuation noise`);

  if (inputs.noValueCount > 0) add("missing_values", -25, `${inputs.noValueCount} asset(s) had no value`);
  if (inputs.hasBlendedPicks) add("blended_picks", -8, "A pick was priced without a known slot");
  // Half the blend's penalty. A slot read off projected standings is a real
  // estimate with real evidence behind it, but it is still a projection of a
  // season that has not been played.
  if (inputs.hasEstimatedPicks) add("estimated_picks", -4, "A pick's slot was estimated from projected standings");
  if (inputs.formatAutoDetected) add("format_detected", 5, "Format auto-detected cleanly from Sleeper");
  if (inputs.pileOnFired) add("pile_on", -10, "Pile-on materially changed a side total");
  // A consolidation credit is a modelled number rather than a measured one, so
  // a verdict that leans on one is a shade less certain than a verdict where
  // the raw values already agreed.
  if (inputs.consolidationApplied) add("consolidation", -6, "A consolidation adjustment shaped the verdict");
  if (inputs.consolidationCapped) add("consolidation_capped", -10, "The two sides are too far apart to balance");

  for (const mod of inputs.ruleModifiers) {
    if (mod !== 0) add("rule_modifier", mod, "Admin rule confidence modifier");
  }

  const rawScore = factors.reduce((sum, f) => sum + f.contribution, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let level: ConfidenceLevel;
  if (score <= settings.confidenceLowMax) level = "low";
  else if (score >= settings.confidenceHighMin) level = "high";
  else level = "medium";

  return {
    enabled: true,
    level,
    label: settings.confidenceLabels[level],
    score,
    factors,
  };
}
