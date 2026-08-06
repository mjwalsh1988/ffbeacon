/**
 * Signal Check calibration phase (Phase 2 of the pipeline).
 *
 * Applies enabled post_format_calibration rules to each asset, honoring the
 * compounding mode, max-adjustment guardrails, and stackability. Produces the
 * adjusted per-asset values and the pre-trade-shape side totals, plus a trace
 * entry for every applied adjustment and every skipped non-stackable rule.
 *
 * Matching uses BASE values (deterministic thresholds); application moves the
 * running value. No double-counting: each rule applies at most once per asset.
 */

import type {
  AnalyzedSide,
  AssetResult,
  PricedAsset,
  RuleTraceEntry,
  SideKey,
} from "./types";
import type { ParsedRule } from "./rules/schema";
import {
  applyValueAction,
  matchCondition,
  selectApplicableRules,
  type CompoundingMode,
  type ConditionContext,
} from "./rules/interpreter";
import { renderTemplate } from "./template";

export interface CalibrationResult {
  sides: Record<SideKey, AnalyzedSide>;
  trace: RuleTraceEntry[];
}

function assetPosition(asset: PricedAsset): string | null {
  return asset.kind === "player" ? asset.position : "PICK";
}

function conditionContextFor(
  asset: PricedAsset,
  formatSlug: string,
  sideAssetCount: number,
  sideBaseTotal: number,
): ConditionContext {
  return {
    formatSlug,
    assetKind: asset.kind,
    position: assetPosition(asset),
    value: asset.baseValue,
    pickRound: asset.kind === "pick" ? asset.round : undefined,
    pickSeason: asset.kind === "pick" ? asset.season : undefined,
    assetCount: sideAssetCount,
    sideTotal: sideBaseTotal,
  };
}

export function applyCalibration(
  pricedSides: Record<SideKey, PricedAsset[]>,
  rules: ParsedRule[],
  formatSlug: string,
  mode: CompoundingMode,
): CalibrationResult {
  const calibrationRules = rules.filter(
    (r) => r.enabled && r.phase === "post_format_calibration" && r.scope === "single_asset",
  );
  const trace: RuleTraceEntry[] = [];
  const sides = {} as Record<SideKey, AnalyzedSide>;

  (["a", "b"] as SideKey[]).forEach((side) => {
    const assets = pricedSides[side];
    const sideBaseTotal = assets.reduce((sum, a) => sum + a.baseValue, 0);
    const results: AssetResult[] = [];

    for (const asset of assets) {
      const ctx = conditionContextFor(asset, formatSlug, assets.length, sideBaseTotal);
      const matched = calibrationRules.filter((r) => matchCondition(r.condition, ctx));
      const { applied, skipped } = selectApplicableRules(matched);

      let running = asset.baseValue;
      for (const rule of applied) {
        const result = applyValueAction(rule.action, asset.baseValue, running, mode, rule.maxAdjustment);
        if (!result) continue;
        const before = running;
        running = result.valueAfter;
        const display = asset.kind === "player" ? asset.name : asset.label;
        trace.push({
          ruleId: rule.id,
          ruleVersion: rule.rulesetVersion,
          ruleLabel: rule.adminLabel,
          phase: "post_format_calibration",
          scope: "single_asset",
          side,
          assetId: asset.assetId,
          valueBefore: before,
          adjustment: result.adjustment,
          valueAfter: running,
          publicExplanation: renderTemplate(rule.publicExplanationTemplate, {
            asset: display,
            side: side.toUpperCase(),
          }),
          adminDebug: `rule=${rule.adminLabel} action=${rule.action.type} delta=${result.adjustment.toFixed(2)} mode=${mode}`,
        });
      }

      for (const rule of skipped) {
        trace.push({
          ruleId: rule.id,
          ruleVersion: rule.rulesetVersion,
          ruleLabel: rule.adminLabel,
          phase: "post_format_calibration",
          scope: "single_asset",
          side,
          assetId: asset.assetId,
          valueBefore: null,
          adjustment: null,
          valueAfter: null,
          publicExplanation: "",
          adminDebug: `skipped (non-stackable, stack_group=${rule.stackGroup})`,
        });
      }

      results.push({
        asset,
        side,
        baseValue: asset.baseValue,
        adjustedValue: running,
      });
    }

    const totalPre = results.reduce((sum, r) => sum + r.adjustedValue, 0);
    sides[side] = {
      side,
      assets: results,
      totalPre,
      totalPost: totalPre,
      // The consolidation pass runs later, in trade-shape. Until then the
      // effective total is just the assets.
      consolidationAdjustment: 0,
      effectiveTotal: totalPre,
    };
  });

  return { sides, trace };
}
