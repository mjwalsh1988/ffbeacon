/**
 * Signal Check pipeline orchestrator.
 *
 * Deterministic, side-effect-free given its inputs (the DB work happens in the
 * caller, which supplies a ValueResolver, settings, and parsed rules). Order:
 *
 *   priceSides -> calibration -> side totals (pre)
 *   -> trade-shape (pile-on + side rules + shape) -> side totals (post)
 *   -> verdict -> confidence -> explanation
 *
 * Phases never mix: format/value resolution, asset calibration, and
 * trade-shape logic are separate modules with separate traces.
 */

import { assessPartialGrade, NO_VERDICT_LABEL } from "@/lib/trade-grading/partial";
import type {
  AnalysisInput,
  PricedAsset,
  ResolvedFormat,
  ResolvedSource,
  SideKey,
  SignalCheckAnalysis,
  SignalCheckSettings,
  TradeShapeResult,
} from "./types";
import type { ParsedRule } from "./rules/schema";
import { SignalCheckError } from "./errors";
import { priceSides, type ValueResolver } from "./value-engine";
import { applyCalibration } from "./calibration";
import { applyTradeShape } from "./trade-shape";
import { computeVerdict } from "./verdict";
import { computeConfidence } from "./confidence";
import { buildExplanation } from "./explanation";
import { VALUE_ENGINE_VERSION, RULE_INTERPRETER_VERSION } from "./versions";

export interface PipelineParams {
  /** Must be Zod-validated and asset-resolved by the caller before this runs. */
  input: AnalysisInput;
  resolver: ValueResolver;
  format: ResolvedFormat;
  source: ResolvedSource;
  settings: SignalCheckSettings;
  rules: ParsedRule[];
  rulesetVersion: number | null;
  /** True only on the Sleeper path when the format was auto-detected cleanly. */
  formatAutoDetected?: boolean;
  /**
   * Top value in this format+source pool, for the consolidation curve. Null is
   * handled: the trade's own best asset stands in, which keeps the shape sane.
   */
  poolMax?: number | null;
}

export function runPipeline(params: PipelineParams): SignalCheckAnalysis {
  const { input, resolver, format, source, settings, rules, rulesetVersion } = params;

  const totalAssets = input.sides.a.length + input.sides.b.length;
  if (totalAssets === 0) {
    throw new SignalCheckError("empty_trade", "Add at least one asset to analyze a trade.");
  }
  if (
    input.sides.a.length > settings.maxAssetsPerSide ||
    input.sides.b.length > settings.maxAssetsPerSide
  ) {
    throw new SignalCheckError(
      "too_many_assets",
      `Each side is limited to ${settings.maxAssetsPerSide} assets.`,
    );
  }

  // 1. Value engine (throws on picks in a redraft format).
  const priced = priceSides(input.sides, resolver, format);

  // 2. Calibration (per-asset, post-format).
  const calibrated = applyCalibration(priced.sides, rules, format.slug, settings.compoundingMode);

  // 3. Trade-shape (side rules + consolidation + shape detection).
  const shaped = applyTradeShape(
    calibrated.sides,
    rules,
    settings,
    format.slug,
    params.poolMax ?? null,
  );

  // 4. Verdict, on the effective totals so the consolidation credit counts.
  // A side with no priced piece and a defender on it gets NO verdict (plan
  // R-19): comparing something against nothing is not a grade.
  const grade = assessPartialGrade(
    (["a", "b"] as SideKey[]).map((side) =>
      priced.sides[side].map((asset) => ({
        noValue: asset.noValue,
        position: asset.kind === "player" ? asset.position : null,
        resolved: asset.kind === "player" ? !asset.unresolved : true,
      })),
    ),
  );
  const verdict = grade.graded
    ? computeVerdict(shaped.sides.a.effectiveTotal, shaped.sides.b.effectiveTotal, settings)
    : {
        label: NO_VERDICT_LABEL,
        winnerSide: null,
        marginPct: 0,
        marginRaw: 0,
        isNeutral: true,
        isBlowout: false,
      };

  // 5. Trade-shape result object.
  const tradeShape: TradeShapeResult = {
    enabled: settings.shapeEnabled,
    key: shaped.shapeKey,
    label: shaped.shapeKey ? (settings.shapeLabels[shaped.shapeKey] ?? shaped.shapeKey) : null,
  };

  // 6. Confidence.
  const pickCount = countPicks(priced.sides);
  const noValueCount = countNoValue(priced.sides);
  const confidence = computeConfidence(
    {
      marginRaw: verdict.marginRaw,
      pickCount,
      noValueCount,
      hasBlendedPicks: priced.hasBlendedPicks,
      hasEstimatedPicks: priced.hasEstimatedPicks,
      formatAutoDetected: params.formatAutoDetected ?? false,
      pileOnFired: shaped.pileOnFired.a || shaped.pileOnFired.b,
      consolidationApplied: shaped.consolidation.applied,
      consolidationCapped: shaped.consolidation.capped,
      ruleModifiers: shaped.confidenceModifiers,
    },
    settings,
  );

  // 7. Explanation.
  const explanation = buildExplanation({
    verdict,
    tradeShape,
    sides: shaped.sides,
    trace: shaped.trace,
    hasMissingValues: priced.hasMissingValues,
    grade,
  });

  const trace = [...priced.trace, ...calibrated.trace, ...shaped.trace];
  const combinedValue = shaped.sides.a.effectiveTotal + shaped.sides.b.effectiveTotal;

  return {
    format,
    source,
    sides: shaped.sides,
    combinedValue,
    verdict,
    consolidation: shaped.consolidation,
    tradeShape,
    confidence,
    explanation,
    trace,
    hasMissingValues: priced.hasMissingValues,
    hasBlendedPicks: priced.hasBlendedPicks,
    hasEstimatedPicks: priced.hasEstimatedPicks,
    partial: grade.partial,
    unpricedCount: grade.unpricedCount,
    unresolvedCount: grade.unresolvedCount,
    graded: grade.graded,
    valueEngineVersion: VALUE_ENGINE_VERSION,
    ruleInterpreterVersion: RULE_INTERPRETER_VERSION,
    rulesetVersion,
    valueCapturedAt: priced.valueCapturedAt,
  };
}

function countPicks(sides: Record<SideKey, PricedAsset[]>): number {
  let n = 0;
  (["a", "b"] as SideKey[]).forEach((side) => {
    for (const a of sides[side]) if (a.kind === "pick") n += 1;
  });
  return n;
}

function countNoValue(sides: Record<SideKey, PricedAsset[]>): number {
  let n = 0;
  (["a", "b"] as SideKey[]).forEach((side) => {
    for (const a of sides[side]) if (a.noValue) n += 1;
  });
  return n;
}
