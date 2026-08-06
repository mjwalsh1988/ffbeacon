/**
 * Freeze a SignalCheckAnalysis into (a) the full private DB row and (b) the
 * public-safe share payload.
 *
 * PRIVACY BOUNDARY: buildPublicPayload is the ONLY path that produces the
 * object exposed on public share pages and OG images. It must never include
 * user_id, sleeper_context, the rule trace, or raw/adjusted value maps. Raw
 * per-side totals are included ONLY when the admin showRawValues toggle is on.
 */

import { formatEastern } from "@/lib/datetime";
import type {
  AnalysisInput,
  PublicSharePayload,
  PublicSidePayload,
  RuleTraceEntry,
  SideKey,
  SignalCheckAnalysis,
  SignalCheckSettings,
} from "./types";

export interface FreezeParams {
  analysis: SignalCheckAnalysis;
  input: AnalysisInput;
  settings: SignalCheckSettings;
  shareId: string;
  userId: string | null;
  isPublic: boolean;
  createdAtIso: string;
  /** Optional Sleeper-derived team names per side (import path). */
  teamLabels?: Partial<Record<SideKey, string | null>>;
  /** Private import context. Never enters public_payload. */
  sleeperContext?: unknown;
  /** Detection evidence for imported trades. */
  formatDetectionEvidence?: unknown;
}

function assetDetail(asset: SignalCheckAnalysis["sides"]["a"]["assets"][number]["asset"]): string | null {
  if (asset.kind === "player") {
    const parts = [asset.position, asset.team].filter((p): p is string => Boolean(p));
    return parts.length ? parts.join(", ") : null;
  }
  return asset.pickPosition === "unknown" ? "Draft pick" : `Draft pick (${asset.pickPosition})`;
}

function buildSidePayload(
  side: SideKey,
  analysis: SignalCheckAnalysis,
  settings: SignalCheckSettings,
  teamLabel: string | null,
): PublicSidePayload {
  const s = analysis.sides[side];
  const c = analysis.consolidation;
  const credited = c.applied && c.favouredSide === side;
  return {
    side,
    teamLabel,
    assets: s.assets.map((r) => ({
      name: r.asset.kind === "player" ? r.asset.name : r.asset.label,
      detail: assetDetail(r.asset),
      kind: r.asset.kind,
      sleeperId: r.asset.kind === "player" ? r.asset.sleeperId : null,
      round: r.asset.kind === "pick" ? r.asset.round : null,
    })),
    total: settings.showRawValues ? Math.round(s.effectiveTotal) : null,
    adjustment: credited && settings.showRawValues ? Math.round(s.consolidationAdjustment) : null,
    adjustmentPct: credited ? Number(c.adjustmentPct.toFixed(1)) : null,
  };
}

export function buildPublicPayload(
  analysis: SignalCheckAnalysis,
  settings: SignalCheckSettings,
  createdAtIso: string,
  teamLabels?: Partial<Record<SideKey, string | null>>,
): PublicSharePayload {
  const snapshotLabel = analysis.valueCapturedAt
    ? `Values as of ${formatEastern(analysis.valueCapturedAt)}`
    : null;

  return {
    featureLabel: settings.publicLabel,
    resultLabel: settings.resultLabel,
    verdictLabel: analysis.verdict.label,
    winnerSide: analysis.verdict.winnerSide,
    marginPct: analysis.verdict.marginPct,
    formatDisplay: analysis.format.display,
    tradeShapeLabel: settings.showTradeShape ? analysis.tradeShape.label : null,
    confidenceLabel: settings.showConfidence ? analysis.confidence.label : null,
    explanation: analysis.explanation,
    adjustmentLabel: analysis.consolidation.applied ? settings.qualityAdjustmentLabel : null,
    sides: [
      buildSidePayload("a", analysis, settings, teamLabels?.a ?? null),
      buildSidePayload("b", analysis, settings, teamLabels?.b ?? null),
    ],
    valueSnapshotLabel: snapshotLabel,
    createdAtIso,
  };
}

export interface FrozenAnalysisRow {
  public_share_id: string;
  user_id: string | null;
  is_public: boolean;
  value_source_slug: string;
  value_engine_version: string;
  rule_interpreter_version: string;
  ruleset_version: number | null;
  format_slug: string;
  format_config_id: string;
  format_detection_evidence: unknown;
  input_assets: AnalysisInput;
  raw_values: Record<string, number>;
  adjusted_values: Record<string, number>;
  side_totals_pre: Record<SideKey, number>;
  side_totals_post: Record<SideKey, number>;
  rule_trace: RuleTraceEntry[];
  trade_shape: string | null;
  confidence: string | null;
  verdict_label: string;
  winner_side: SideKey | null;
  margin: number | null;
  sleeper_context: unknown;
  public_payload: PublicSharePayload;
  value_captured_at: string | null;
}

export function freezeAnalysis(params: FreezeParams): FrozenAnalysisRow {
  const { analysis, input, settings, shareId, userId, isPublic, createdAtIso } = params;

  const rawValues: Record<string, number> = {};
  const adjustedValues: Record<string, number> = {};
  (["a", "b"] as SideKey[]).forEach((side) => {
    for (const r of analysis.sides[side].assets) {
      rawValues[r.asset.assetId] = r.baseValue;
      adjustedValues[r.asset.assetId] = r.adjustedValue;
    }
  });

  return {
    public_share_id: shareId,
    user_id: userId,
    is_public: isPublic,
    value_source_slug: analysis.source.slug,
    value_engine_version: analysis.valueEngineVersion,
    rule_interpreter_version: analysis.ruleInterpreterVersion,
    ruleset_version: analysis.rulesetVersion,
    format_slug: analysis.format.slug,
    format_config_id: analysis.format.configId,
    format_detection_evidence: params.formatDetectionEvidence ?? null,
    input_assets: input,
    raw_values: rawValues,
    adjusted_values: adjustedValues,
    side_totals_pre: { a: analysis.sides.a.totalPre, b: analysis.sides.b.totalPre },
    side_totals_post: { a: analysis.sides.a.totalPost, b: analysis.sides.b.totalPost },
    rule_trace: analysis.trace,
    trade_shape: analysis.tradeShape.label,
    confidence: analysis.confidence.label,
    verdict_label: analysis.verdict.label,
    winner_side: analysis.verdict.winnerSide,
    margin: analysis.verdict.marginPct,
    sleeper_context: params.sleeperContext ?? null,
    public_payload: buildPublicPayload(analysis, settings, createdAtIso, params.teamLabels),
    value_captured_at: analysis.valueCapturedAt,
  };
}
