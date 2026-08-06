/**
 * Serializable "builder view" of a SignalCheckAnalysis for client surfaces
 * (the manual builder and the Sleeper import wizard). This is a plain module
 * (not "use server") so multiple server actions can share toBuilderView.
 *
 * The builder is the first-party tool surface, so it always shows the shape and
 * confidence it computed. The public-share toggles only gate the saved
 * public_payload (see freeze.ts). Raw value points are gated by showRawValues.
 */

import type { SideKey, SignalCheckAnalysis, SignalCheckSettings } from "./types";

export interface BuilderAssetView {
  name: string;
  detail: string | null;
  value: number | null;
  noValue: boolean;
}

export interface BuilderSideView {
  side: SideKey;
  teamLabel: string | null;
  assets: BuilderAssetView[];
  /** Effective total: the assets plus any consolidation credit. */
  total: number | null;
  /** Consolidation credit in points, when raw values are shown. */
  adjustment: number | null;
  /**
   * The same credit as a share of the whole trade. Shown when raw points are
   * hidden, so the line item still means something without exposing the scale.
   */
  adjustmentPct: number | null;
}

export interface BuilderView {
  featureLabel: string;
  resultLabel: string;
  verdictLabel: string;
  winnerSide: SideKey | null;
  marginPct: number;
  isNeutral: boolean;
  isBlowout: boolean;
  formatDisplay: string;
  tradeShapeLabel: string | null;
  confidenceLabel: string | null;
  confidenceLevel: string | null;
  explanation: string;
  sides: BuilderSideView[];
  hasMissingValues: boolean;
  hasAssumedPicks: boolean;
  showRawValues: boolean;
  /** Row label for the consolidation credit. Null when none applied. */
  adjustmentLabel: string | null;
}

function assetDetail(
  asset: SignalCheckAnalysis["sides"]["a"]["assets"][number]["asset"],
): string | null {
  if (asset.kind === "player") {
    const parts = [asset.position, asset.team].filter((p): p is string => Boolean(p));
    return parts.length ? parts.join(", ") : null;
  }
  return asset.pickPosition === "unknown" ? "Draft pick" : `Draft pick (${asset.pickPosition})`;
}

export function toBuilderView(
  analysis: SignalCheckAnalysis,
  settings: SignalCheckSettings,
  teamLabels?: Partial<Record<SideKey, string | null>>,
): BuilderView {
  const consolidation = analysis.consolidation;

  const sides: BuilderSideView[] = (["a", "b"] as SideKey[]).map((side) => {
    const s = analysis.sides[side];
    const credited = consolidation.applied && consolidation.favouredSide === side;
    return {
      side,
      teamLabel: teamLabels?.[side] ?? null,
      assets: s.assets.map((r) => ({
        name: r.asset.kind === "player" ? r.asset.name : r.asset.label,
        detail: assetDetail(r.asset),
        value: settings.showRawValues ? Math.round(r.adjustedValue) : null,
        noValue: r.asset.noValue,
      })),
      total: settings.showRawValues ? Math.round(s.effectiveTotal) : null,
      adjustment: credited && settings.showRawValues ? Math.round(s.consolidationAdjustment) : null,
      adjustmentPct: credited ? Number(consolidation.adjustmentPct.toFixed(1)) : null,
    };
  });

  return {
    featureLabel: settings.publicLabel,
    resultLabel: settings.resultLabel,
    verdictLabel: analysis.verdict.label,
    winnerSide: analysis.verdict.winnerSide,
    marginPct: analysis.verdict.marginPct,
    isNeutral: analysis.verdict.isNeutral,
    isBlowout: analysis.verdict.isBlowout,
    formatDisplay: analysis.format.display,
    tradeShapeLabel: analysis.tradeShape.label,
    confidenceLabel: analysis.confidence.label,
    confidenceLevel: analysis.confidence.level,
    explanation: analysis.explanation,
    sides,
    hasMissingValues: analysis.hasMissingValues,
    hasAssumedPicks: analysis.hasAssumedPicks,
    showRawValues: settings.showRawValues,
    adjustmentLabel: consolidation.applied ? settings.qualityAdjustmentLabel : null,
  };
}
