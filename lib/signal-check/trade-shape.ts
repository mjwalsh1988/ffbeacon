/**
 * Signal Check trade-shape phase (Phase 3 of the pipeline).
 *
 * Order, all operating on the post-calibration side totals:
 *   1. Pile-on (legacy, off by default): once per side, diminishing returns on
 *      depth beyond the top K, capped at max penalty. Superseded by step 3;
 *      an admin can re-enable it but running both charges a package twice.
 *   2. Post-aggregation one_side rules (side_penalty_pct / side_boost_pct).
 *   3. Consolidation: the quality comparison from lib/trade-quality.ts, which
 *      credits the side holding the better single asset with the value the
 *      other side would have to add to draw level. Side totals are NOT rewritten
 *      by it; the credit lands in `consolidationAdjustment` and the sum of the
 *      two goes in `effectiveTotal`, so a reader can still see the plain
 *      arithmetic next to the adjustment that changed the answer.
 *   4. Trade-shape label detection (deterministic heuristics + assign_shape
 *      rule override) and confidence_modifier / trace_note rules.
 *
 * Determinism: thresholds come from settings; the same inputs always produce
 * the same totals, label, and trace.
 */

import { solveTradeBalance } from "@/lib/trade-quality";
import type {
  AnalyzedSide,
  ConsolidationResult,
  RuleTraceEntry,
  SideKey,
  SignalCheckSettings,
} from "./types";
import type { ParsedRule } from "./rules/schema";
import {
  applySideAction,
  matchCondition,
  selectApplicableRules,
  type ConditionContext,
} from "./rules/interpreter";
import { renderTemplate } from "./template";

export interface TradeShapePhaseResult {
  sides: Record<SideKey, AnalyzedSide>;
  trace: RuleTraceEntry[];
  shapeKey: string | null;
  pileOnFired: Record<SideKey, boolean>;
  consolidation: ConsolidationResult;
  confidenceModifiers: number[];
}

const NO_CONSOLIDATION: ConsolidationResult = {
  enabled: false,
  applied: false,
  favouredSide: null,
  adjustment: 0,
  adjustmentPct: 0,
  qualityTotals: { a: 0, b: 0 },
  discountedCounts: { a: 0, b: 0 },
  capped: false,
};

interface SideStats {
  count: number;
  playerCount: number;
  pickCount: number;
  pickValue: number;
  bestValue: number;
  adjustedTotal: number;
}

function sideStats(side: AnalyzedSide): SideStats {
  let playerCount = 0;
  let pickCount = 0;
  let pickValue = 0;
  let bestValue = 0;
  let adjustedTotal = 0;
  for (const r of side.assets) {
    adjustedTotal += r.adjustedValue;
    if (r.adjustedValue > bestValue) bestValue = r.adjustedValue;
    if (r.asset.kind === "pick") {
      pickCount += 1;
      pickValue += r.adjustedValue;
    } else {
      playerCount += 1;
    }
  }
  return { count: side.assets.length, playerCount, pickCount, pickValue, bestValue, adjustedTotal };
}

/**
 * Compute the side total after pile-on. Returns the new total and the capped
 * penalty (0 when pile-on did not fire). Pure.
 */
export function computePileOn(
  side: AnalyzedSide,
  settings: SignalCheckSettings,
): { newTotal: number; penalty: number } {
  if (!settings.pileOnEnabled) return { newTotal: side.totalPre, penalty: 0 };
  if (side.assets.length < settings.pileOnMinAssets) {
    return { newTotal: side.totalPre, penalty: 0 };
  }
  const values = side.assets.map((a) => a.adjustedValue).sort((x, y) => y - x);
  const k = Math.max(0, Math.floor(settings.pileOnTopK));
  const base = Math.min(1, Math.max(0, settings.pileOnCurveBase));
  let penalty = 0;
  for (let i = k; i < values.length; i += 1) {
    const factor = Math.pow(base, i - k + 1);
    penalty += values[i] * (1 - factor);
  }
  const cap = side.totalPre * (settings.pileOnMaxPenaltyPct / 100);
  const capped = Math.min(penalty, cap);
  return { newTotal: Math.max(0, side.totalPre - capped), penalty: capped };
}

/**
 * Price the consolidation gap and hand each side its credit.
 *
 * Returns the sides unchanged when quality scoring is off or nothing separated
 * them, so the phase is a no-op rather than a rounding source in that case.
 */
export function applyConsolidation(
  sides: Record<SideKey, AnalyzedSide>,
  settings: SignalCheckSettings,
  poolMax: number | null,
): { sides: Record<SideKey, AnalyzedSide>; consolidation: ConsolidationResult } {
  const withZero = (): Record<SideKey, AnalyzedSide> => ({
    a: { ...sides.a, consolidationAdjustment: 0, effectiveTotal: sides.a.totalPost },
    b: { ...sides.b, consolidationAdjustment: 0, effectiveTotal: sides.b.totalPost },
  });

  if (!settings.qualityEnabled) {
    return { sides: withZero(), consolidation: { ...NO_CONSOLIDATION } };
  }

  // The comparison runs on the values the reader can see, which are the
  // post-calibration asset values, NOT the side totals. A side total already
  // has the depth baked in, and the whole point is to unbake it.
  const valuesOf = (side: SideKey) => sides[side].assets.map((r) => r.adjustedValue);
  const solved = solveTradeBalance(valuesOf("a"), valuesOf("b"), poolMax, settings.quality);

  const next = withZero();
  const combined = solved.effective.a + solved.effective.b;
  const adjustmentPct = combined > 0 ? (solved.adjustment / combined) * 100 : 0;

  if (solved.applied && solved.favoured) {
    const side = solved.favoured;
    next[side] = {
      ...next[side],
      consolidationAdjustment: solved.adjustment,
      effectiveTotal: sides[side].totalPost + solved.adjustment,
    };
  }

  return {
    sides: next,
    consolidation: {
      enabled: true,
      applied: solved.applied,
      favouredSide: solved.favoured,
      adjustment: solved.applied ? solved.adjustment : 0,
      adjustmentPct: solved.applied ? adjustmentPct : 0,
      qualityTotals: { a: solved.a.qualityTotal, b: solved.b.qualityTotal },
      discountedCounts: { a: solved.a.discountedCount, b: solved.b.discountedCount },
      capped: solved.capped,
    },
  };
}

function detectShapeKey(
  sides: Record<SideKey, AnalyzedSide>,
  stats: Record<SideKey, SideStats>,
  clogged: boolean,
  settings: SignalCheckSettings,
): string | null {
  if (!settings.shapeEnabled) return null;

  // Measured on the effective totals so the shape and the verdict can never
  // disagree about whether a trade is close.
  const totalA = sides.a.effectiveTotal;
  const totalB = sides.b.effectiveTotal;
  const sum = totalA + totalB;
  const marginPct = sum > 0 ? (Math.abs(totalA - totalB) / sum) * 100 : 0;

  if (marginPct < settings.neutralThresholdPct) return "near_even";
  if (clogged) return "roster_clog";

  // Stud-for-stud: one player per side.
  if (
    stats.a.count === 1 &&
    stats.b.count === 1 &&
    stats.a.playerCount === 1 &&
    stats.b.playerCount === 1
  ) {
    return "stud_swap";
  }

  // Pick-heavy: either side's pick value dominates that side.
  const pickShare = (s: SideStats) => (s.adjustedTotal > 0 ? (s.pickValue / s.adjustedTotal) * 100 : 0);
  if (pickShare(stats.a) > settings.shapePickSharePct || pickShare(stats.b) > settings.shapePickSharePct) {
    // Dynasty win-now / rebuild framing: a side trading picks for an
    // established player package reads as a win-now move.
    const aPicksForPlayers = pickShare(stats.a) > settings.shapePickSharePct && stats.b.playerCount > 0 && stats.b.pickCount === 0;
    const bPicksForPlayers = pickShare(stats.b) > settings.shapePickSharePct && stats.a.playerCount > 0 && stats.a.pickCount === 0;
    if (aPicksForPlayers || bPicksForPlayers) return "win_now";
    return "pick_heavy";
  }

  // Consolidation: one side's single best asset dominates while the other side
  // sends a multi-asset package (many-for-one).
  const bestShare = (s: SideStats) => (s.adjustedTotal > 0 ? (s.bestValue / s.adjustedTotal) * 100 : 0);
  const aConsol = bestShare(stats.a) > settings.shapeBestSharePct && stats.a.count === 1 && stats.b.count >= 2;
  const bConsol = bestShare(stats.b) > settings.shapeBestSharePct && stats.b.count === 1 && stats.a.count >= 2;
  if (aConsol || bConsol) return "consolidation";

  // Depth package: a side of several pieces with no dominant asset.
  const isDepth = (s: SideStats) => s.count >= 3 && bestShare(s) < settings.shapeBestSharePct;
  if (isDepth(stats.a) || isDepth(stats.b)) return "depth";

  return null;
}

export function applyTradeShape(
  calibratedSides: Record<SideKey, AnalyzedSide>,
  rules: ParsedRule[],
  settings: SignalCheckSettings,
  formatSlug: string,
  poolMax: number | null = null,
): TradeShapePhaseResult {
  const trace: RuleTraceEntry[] = [];
  const pileOnFired: Record<SideKey, boolean> = { a: false, b: false };
  const confidenceModifiers: number[] = [];

  const sides = {} as Record<SideKey, AnalyzedSide>;

  // 1. Pile-on (built-in), once per side.
  (["a", "b"] as SideKey[]).forEach((side) => {
    const s = calibratedSides[side];
    const { newTotal, penalty } = computePileOn(s, settings);
    sides[side] = { ...s, totalPost: newTotal };
    if (penalty > 0) {
      pileOnFired[side] = true;
      trace.push({
        ruleId: "pile-on",
        ruleVersion: null,
        ruleLabel: "Pile-on (depth discount)",
        phase: "post_aggregation_trade_shape",
        scope: "one_side",
        side,
        assetId: null,
        valueBefore: s.totalPre,
        adjustment: -penalty,
        valueAfter: newTotal,
        publicExplanation: renderTemplate(settings.pileOnTemplate, {
          side: side.toUpperCase(),
          k: settings.pileOnTopK,
        }),
        adminDebug: `pile-on penalty=${penalty.toFixed(2)} topK=${settings.pileOnTopK} base=${settings.pileOnCurveBase} cap=${settings.pileOnMaxPenaltyPct}%`,
      });
    }
  });

  // 2. Post-aggregation one_side side adjustments.
  const sideRules = rules.filter(
    (r) => r.enabled && r.phase === "post_aggregation_trade_shape" && r.scope === "one_side",
  );
  (["a", "b"] as SideKey[]).forEach((side) => {
    const s = sides[side];
    const ctx: ConditionContext = {
      formatSlug,
      assetCount: s.assets.length,
      sideTotal: s.totalPost,
      bestAssetShare: s.totalPost > 0 ? sideStats(s).bestValue / s.totalPost : 0,
    };
    const matched = sideRules.filter((r) => matchCondition(r.condition, ctx));
    const { applied, skipped } = selectApplicableRules(matched);
    let running = s.totalPost;
    for (const rule of applied) {
      const result = applySideAction(rule.action, running, rule.maxAdjustment);
      if (!result) continue;
      const before = running;
      running = result.valueAfter;
      trace.push({
        ruleId: rule.id,
        ruleVersion: rule.rulesetVersion,
        ruleLabel: rule.adminLabel,
        phase: "post_aggregation_trade_shape",
        scope: "one_side",
        side,
        assetId: null,
        valueBefore: before,
        adjustment: result.adjustment,
        valueAfter: running,
        publicExplanation: renderTemplate(rule.publicExplanationTemplate, { side: side.toUpperCase() }),
        adminDebug: `rule=${rule.adminLabel} action=${rule.action.type} delta=${result.adjustment.toFixed(2)}`,
      });
    }
    for (const rule of skipped) {
      trace.push({
        ruleId: rule.id,
        ruleVersion: rule.rulesetVersion,
        ruleLabel: rule.adminLabel,
        phase: "post_aggregation_trade_shape",
        scope: "one_side",
        side,
        assetId: null,
        valueBefore: null,
        adjustment: null,
        valueAfter: null,
        publicExplanation: "",
        adminDebug: `skipped (non-stackable, stack_group=${rule.stackGroup})`,
      });
    }
    sides[side] = { ...s, totalPost: running };
  });

  // 3. Consolidation. Side totals are left alone; the credit lands beside them.
  const consolidated = applyConsolidation(sides, settings, poolMax);
  const consolidation = consolidated.consolidation;
  (["a", "b"] as SideKey[]).forEach((side) => {
    sides[side] = consolidated.sides[side];
  });

  if (consolidation.applied && consolidation.favouredSide) {
    const side = consolidation.favouredSide;
    trace.push({
      ruleId: "consolidation",
      ruleVersion: null,
      ruleLabel: settings.qualityAdjustmentLabel,
      phase: "post_aggregation_trade_shape",
      scope: "one_side",
      side,
      assetId: null,
      valueBefore: sides[side].totalPost,
      adjustment: consolidation.adjustment,
      valueAfter: sides[side].effectiveTotal,
      publicExplanation: renderTemplate(settings.qualityTemplate, {
        side: side.toUpperCase(),
      }),
      adminDebug: `consolidation quality a=${consolidation.qualityTotals.a.toFixed(2)} b=${consolidation.qualityTotals.b.toFixed(2)} adjustment=${consolidation.adjustment.toFixed(2)} discounted=${consolidation.discountedCounts.a}/${consolidation.discountedCounts.b} capped=${consolidation.capped}`,
    });
  }

  // 4. Trade-shape detection + whole_trade rules (assign_shape, confidence, note).
  const stats: Record<SideKey, SideStats> = { a: sideStats(sides.a), b: sideStats(sides.b) };
  // A roster clog is a side carrying pieces the quality pass had to discount,
  // whichever mechanism found them.
  const clogged =
    pileOnFired.a ||
    pileOnFired.b ||
    consolidation.discountedCounts.a >= 2 ||
    consolidation.discountedCounts.b >= 2;
  let shapeKey = detectShapeKey(sides, stats, clogged, settings);

  const wholeTradeCtx: ConditionContext = {
    formatSlug,
    assetCount: sides.a.assets.length + sides.b.assets.length,
    sideTotal: sides.a.effectiveTotal + sides.b.effectiveTotal,
    tradeShape: shapeKey,
  };
  const wholeRules = rules.filter(
    (r) => r.enabled && r.phase === "post_aggregation_trade_shape" && r.scope === "whole_trade",
  );
  const matchedWhole = wholeRules.filter((r) => matchCondition(r.condition, wholeTradeCtx));
  const { applied: appliedWhole } = selectApplicableRules(matchedWhole);
  for (const rule of appliedWhole) {
    if (rule.action.type === "assign_shape") {
      shapeKey = rule.action.value;
    } else if (rule.action.type === "confidence_modifier") {
      confidenceModifiers.push(rule.action.value);
    }
    trace.push({
      ruleId: rule.id,
      ruleVersion: rule.rulesetVersion,
      ruleLabel: rule.adminLabel,
      phase: "post_aggregation_trade_shape",
      scope: "whole_trade",
      side: null,
      assetId: null,
      valueBefore: null,
      adjustment: null,
      valueAfter: null,
      publicExplanation: renderTemplate(rule.publicExplanationTemplate, {}),
      adminDebug: `rule=${rule.adminLabel} action=${rule.action.type}`,
    });
  }

  return { sides, trace, shapeKey, pileOnFired, consolidation, confidenceModifiers };
}
