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
  total: number | null;
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
  const sides: BuilderSideView[] = (["a", "b"] as SideKey[]).map((side) => {
    const s = analysis.sides[side];
    return {
      side,
      teamLabel: teamLabels?.[side] ?? null,
      assets: s.assets.map((r) => ({
        name: r.asset.kind === "player" ? r.asset.name : r.asset.label,
        detail: assetDetail(r.asset),
        value: settings.showRawValues ? Math.round(r.adjustedValue) : null,
        noValue: r.asset.noValue,
      })),
      total: settings.showRawValues ? Math.round(s.totalPost) : null,
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
  };
}
