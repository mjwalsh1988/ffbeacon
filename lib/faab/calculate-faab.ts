/**
 * Pure FAAB strategy calculator.
 *
 * Given a selected player (its rank + value as already resolved upstream), the
 * user's league shape, need, and remaining budget, plus the editable settings,
 * this returns a recommended bid range with a tier, an aggression label, and a
 * plain-language explanation.
 *
 * It NEVER fetches or mutates anything. It only consumes the numbers passed in,
 * so it is trivially unit-testable and safe to call from a useMemo.
 *
 * Model summary:
 *   leagueDemand = teams * offensiveStarters
 *   playerRatio  = overallRank / leagueDemand   (lower = scarcer/more valuable)
 *   1. Pick a baseline percent-of-budget band from playerRatio.
 *   2. Apply a league-depth multiplier (shallow boosts elite / cuts depth;
 *      deep boosts depth / trims elite emphasis).
 *   3. Apply a source-agnostic value multiplier from the player's value
 *      relative to this pool's replacement and elite value (falls back to no
 *      change when value/pool data is missing).
 *   4. Apply the need multiplier.
 *   5. Cap to the tier ceiling, clamp to the budget, and enforce a 1-FAAB floor
 *      for everything except a true deep-flyer zero.
 *   6. A dynamic dump mechanic can override with a "spend most of your budget"
 *      range when the player is well inside the league's dump threshold.
 */

import type {
  BidBand,
  FaabCalcInput,
  FaabResult,
  AggressionLabel,
} from "./types";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Find the band whose [minRatio, maxRatio) contains the ratio. The final band
 * (maxRatio null) catches everything above. Falls back to the last band. */
function bandForRatio(bands: BidBand[], ratio: number): BidBand {
  for (const band of bands) {
    const underMax = band.maxRatio === null ? true : ratio < band.maxRatio;
    if (ratio >= band.minRatio && underMax) return band;
  }
  return bands[bands.length - 1];
}

/** Value of the pool entry whose overallRank is closest to targetRank and has a
 * usable (positive) value. Returns null when the pool gives us nothing. */
function valueNearRank(
  pool: { overallRank: number; value: number | null }[],
  targetRank: number,
): number | null {
  let best: { dist: number; value: number } | null = null;
  for (const entry of pool) {
    if (entry.value === null || !(entry.value > 0)) continue;
    const dist = Math.abs(entry.overallRank - targetRank);
    if (best === null || dist < best.dist) {
      best = { dist, value: entry.value };
    }
  }
  return best?.value ?? null;
}

function aggressionFor(isDump: boolean, targetPct: number): AggressionLabel {
  if (isDump) return "Empty the Clip";
  if (targetPct >= 60) return "Empty the Clip";
  if (targetPct >= 45) return "Aggressive";
  if (targetPct >= 15) return "Balanced";
  return "Conservative";
}

function ratioContext(ratio: number): string {
  if (ratio <= 0.6) return "well inside the weekly starter range";
  if (ratio <= 0.85) return "comfortably in the weekly starter range";
  if (ratio <= 1.1) return "right around the weekly starter line";
  if (ratio <= 1.4) return "just beyond the weekly starter range";
  if (ratio <= 1.8) return "in bench-depth territory";
  if (ratio <= 2.4) return "in speculative-add territory";
  return "deep on the waiver wire";
}

function valuePhrase(valueScore: number | null, neutral: number): string {
  if (valueScore === null) return "";
  if (valueScore >= neutral + 0.25) return ", and the value backs it up";
  if (valueScore <= neutral - 0.25) return ", though the value runs a bit light";
  return "";
}

export function calculateFaabRecommendation(input: FaabCalcInput): FaabResult {
  const {
    player,
    needLevel,
    teams,
    offensiveStarters,
    settings,
    playerPool,
  } = input;

  const notices: string[] = [];

  // Budget is always treated as a non-negative whole number of FAAB dollars.
  const remainingBudget = Math.max(0, Math.floor(input.remainingBudget || 0));

  const leagueDemand = Math.max(1, teams * offensiveStarters);
  const needMultiplier =
    settings.needMultipliers[needLevel] ?? settings.needMultipliers.medium;

  // ---- Value normalization (source-agnostic, pool-relative) ----------------
  const { valueNormalization: vn } = settings;
  const replacementRank = Math.max(1, Math.round(leagueDemand * vn.replacementRankMultiplier));
  const eliteRank = Math.max(1, Math.round(leagueDemand * vn.eliteRankMultiplier));

  let valueScore: number | null = null;
  let replacementValue: number | null = null;
  let eliteValue: number | null = null;
  let usedValueData = false;

  const pool = playerPool ?? [];
  if (player.value !== null && player.value > 0 && pool.length > 0) {
    replacementValue = valueNearRank(pool, replacementRank);
    eliteValue = valueNearRank(pool, eliteRank);
    if (
      replacementValue !== null &&
      eliteValue !== null &&
      eliteValue > replacementValue
    ) {
      const raw = (player.value - replacementValue) / (eliteValue - replacementValue);
      valueScore = clamp(raw, vn.valueScoreClampMin, vn.valueScoreClampMax);
      usedValueData = true;
    }
  }
  if (!usedValueData) {
    notices.push(settings.copy.missingValueNote);
  }

  // valueScore -> +/- multiplier, neutral at vn.valueScoreNeutral.
  let valueMultiplier = 1;
  if (valueScore !== null) {
    const maxImpact = vn.valueAdjustmentMaxPct / 100;
    if (valueScore >= vn.valueScoreNeutral) {
      const span = Math.max(1e-6, vn.valueScoreClampMax - vn.valueScoreNeutral);
      const t = clamp((valueScore - vn.valueScoreNeutral) / span, 0, 1);
      valueMultiplier = 1 + t * maxImpact;
    } else {
      const span = Math.max(1e-6, vn.valueScoreNeutral - vn.valueScoreClampMin);
      const t = clamp((vn.valueScoreNeutral - valueScore) / span, 0, 1);
      valueMultiplier = 1 - t * maxImpact;
    }
  }

  // ---- Rank / ratio + band -------------------------------------------------
  const hasRank = player.overallRank !== null && player.overallRank > 0;
  if (!hasRank) {
    notices.push(
      "This recommendation is approximate because this player has no overall rank in the current data.",
    );
  }
  const effectiveOverallRank = hasRank
    ? (player.overallRank as number)
    : replacementRank; // no rank -> treat as replacement-level
  const playerRatio = effectiveOverallRank / leagueDemand;

  const band = bandForRatio(settings.bidCurve, playerRatio);

  // ---- League depth multiplier ---------------------------------------------
  const { depthAdjustments: da } = settings;
  let depthTier: "shallow" | "standard" | "deep" = "standard";
  if (leagueDemand <= da.shallowMaxDemand) depthTier = "shallow";
  else if (leagueDemand > da.standardMaxDemand) depthTier = "deep";

  const isEliteRatio = playerRatio <= da.eliteRatioMax;
  const isDepthRatio = playerRatio >= da.depthRatioMin;
  let depthMultiplier = 1;
  if (depthTier === "shallow") {
    if (isEliteRatio) depthMultiplier = 1 + da.shallowEliteBoostPct / 100;
    else if (isDepthRatio) depthMultiplier = 1 - da.shallowDepthCutPct / 100;
  } else if (depthTier === "deep") {
    if (isEliteRatio) depthMultiplier = 1 - da.deepEliteBoostReductionPct / 100;
    else if (isDepthRatio) depthMultiplier = 1 + da.deepDepthBoostPct / 100;
  }
  depthMultiplier = Math.max(0, depthMultiplier);

  // ---- Combine: baseline band * depth * value * need -----------------------
  const combined = depthMultiplier * valueMultiplier * needMultiplier;
  const preCapMinPct = band.minPct * combined;
  const preCapMaxPct = band.maxPct * combined;

  // ---- Dynamic FAAB dump ---------------------------------------------------
  const dumpRankThreshold = leagueDemand * settings.dump.thresholdRatio;
  const isDumpCandidate =
    settings.dump.enabled &&
    ((hasRank && effectiveOverallRank <= dumpRankThreshold) ||
      (valueScore !== null && valueScore >= settings.dump.valueScoreThreshold));

  let lowPct: number;
  let highPct: number;
  let tierLabel = band.tierLabel;

  if (isDumpCandidate) {
    const range = settings.dump.ranges[needLevel] ?? settings.dump.ranges.medium;
    lowPct = clamp(range.minPct, 0, 100);
    highPct = clamp(range.maxPct, 0, 100);
    notices.push(settings.copy.dumpNote);
  } else {
    // Cap to the tier ceiling so high need cannot blow a low tier up.
    lowPct = clamp(preCapMinPct, 0, band.capPct);
    highPct = clamp(preCapMaxPct, 0, band.capPct);
  }

  // Final clamps + ordering.
  lowPct = clamp(lowPct, 0, 100);
  highPct = clamp(highPct, 0, 100);
  if (lowPct > highPct) lowPct = highPct;

  // ---- Dollars -------------------------------------------------------------
  let lowBid = Math.round((lowPct / 100) * remainingBudget);
  let highBid = Math.round((highPct / 100) * remainingBudget);

  // Never exceed the remaining budget.
  lowBid = clamp(lowBid, 0, remainingBudget);
  highBid = clamp(highBid, 0, remainingBudget);

  // 1-FAAB floor: only a true deep flyer (the final, lowest band) is allowed to
  // land at 0. Everything else with any budget gets at least 1.
  const isDeepFlyer = band.maxRatio === null;
  if (remainingBudget > 0 && !isDumpCandidate && !isDeepFlyer) {
    if (highBid < 1) highBid = 1;
    if (lowBid < 1) lowBid = 1;
  }
  if (lowBid > highBid) lowBid = highBid;

  const targetPct = (lowPct + highPct) / 2;
  const aggressionLabel = aggressionFor(isDumpCandidate, targetPct);

  // ---- Explanation ---------------------------------------------------------
  let explanation: string;
  if (isDumpCandidate) {
    explanation = `This player is well inside the dynamic dump threshold for your ${teams}-team, start-${offensiveStarters} setup. Emptying most of your budget is reasonable if you need the position.`;
  } else {
    explanation = `This player is ${ratioContext(playerRatio)} for your ${teams}-team, start-${offensiveStarters} league${valuePhrase(
      valueScore,
      vn.valueScoreNeutral,
    )}. ${tierLabel} like this generally warrant a ${aggressionLabel.toLowerCase()} bid.`;
  }

  return {
    lowBid,
    highBid,
    lowPct: Math.round(lowPct),
    highPct: Math.round(highPct),
    targetPct: Math.round(targetPct),
    tierLabel,
    aggressionLabel,
    isDumpCandidate,
    explanation,
    notices,
    debugContext: {
      leagueDemand,
      playerRatio: hasRank ? playerRatio : null,
      bandId: band.id,
      baselineMinPct: band.minPct,
      baselineMaxPct: band.maxPct,
      depthTier,
      depthMultiplier,
      valueScore,
      valueMultiplier,
      needMultiplier,
      replacementRank,
      eliteRank,
      replacementValue,
      eliteValue,
      preCapMinPct,
      preCapMaxPct,
      capPct: isDumpCandidate ? null : band.capPct,
      dumpRankThreshold,
      isDumpCandidate,
      usedValueData,
    },
  };
}
