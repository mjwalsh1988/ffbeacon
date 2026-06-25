/**
 * Signal Check trade-shape phase (Phase 3 of the pipeline).
 *
 * Order, all operating on the post-calibration side totals:
 *   1. Pile-on (built-in, settings-driven): once per side, diminishing returns
 *      on depth beyond the top K, capped at max penalty. ONE trace entry per
 *      affected side. Never boosts the other side; never combined with an
 *      asset-level pile-on (there is none).
 *   2. Post-aggregation one_side rules (side_penalty_pct / side_boost_pct).
 *   3. Trade-shape label detection (deterministic heuristics + assign_shape
 *      rule override) and confidence_modifier / trace_note rules.
 *
 * Determinism: thresholds come from settings; the same inputs always produce
 * the same totals, label, and trace.
 */

import type {
  AnalyzedSide,
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
  confidenceModifiers: number[];
}

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

function detectShapeKey(
  sides: Record<SideKey, AnalyzedSide>,
  stats: Record<SideKey, SideStats>,
  pileOnFired: Record<SideKey, boolean>,
  settings: SignalCheckSettings,
): string | null {
  if (!settings.shapeEnabled) return null;

  const totalA = sides.a.totalPost;
  const totalB = sides.b.totalPost;
  const sum = totalA + totalB;
  const marginPct = sum > 0 ? (Math.abs(totalA - totalB) / sum) * 100 : 0;

  if (marginPct < settings.neutralThresholdPct) return "near_even";
  if (pileOnFired.a || pileOnFired.b) return "roster_clog";

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

  // 3. Trade-shape detection + whole_trade rules (assign_shape, confidence, note).
  const stats: Record<SideKey, SideStats> = { a: sideStats(sides.a), b: sideStats(sides.b) };
  let shapeKey = detectShapeKey(sides, stats, pileOnFired, settings);

  const wholeTradeCtx: ConditionContext = {
    formatSlug,
    assetCount: sides.a.assets.length + sides.b.assets.length,
    sideTotal: sides.a.totalPost + sides.b.totalPost,
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

  return { sides, trace, shapeKey, pileOnFired, confidenceModifiers };
}
