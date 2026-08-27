/**
 * Pure helpers and branded image fragments for the Positional WAR OG card.
 *
 * Lives outside route.tsx on purpose: Next's App Router route type-checking
 * rejects a route.ts/route.tsx file that exports anything besides the known
 * route config symbols (GET, runtime, dynamic, etc.), so every function this
 * module exports for app/api/og/war/[league_id]/route.test.ts to exercise
 * directly has to live in a sibling file instead.
 */

import { ImageResponse } from "next/og";
import { POSITION_SERIES, markerPath } from "@/components/chart-kit";
import { PULSE_POSITIONS } from "@/lib/power-pulse/types";
// The scarcest/deepest selection is shared with the rail summary card (E6),
// not reimplemented here: docs/league-pulse-positional-war-plan.md 15.5.2
// says the card's headline must use the same deterministic template the rail
// summary uses, and importing this rather than duplicating the tie-break
// logic (max war_rank_1, ties by min cliff_rank, a tertiary position-order
// tiebreak for full determinism) is what makes that guarantee real. See
// components/chart-kit.tsx's own header comment for the precedent: shared
// furniture that both a page and an OG route import lives outside app/, and
// this pure selection module has no React/JSX dependency, so it is safe to
// import into a route file the same way.
import { selectScarcestAndDeepest } from "@/components/league-war/selection";
import type { ChartGeometry } from "@/lib/positional-war/chart-geometry";
import type { PositionCurve, PulsePosition, WarCurvePoint } from "@/lib/positional-war/types";

export const SIZE = { width: 1200, height: 630 } as const;
export const CHART = { width: 1040, height: 380 } as const;

// FF Beacon brand colors per CLAUDE.md / plan.md. NEVER reference DPC's
// gold or violet on #0c0c18. Copied verbatim from
// app/api/og/league/[league_id]/route.tsx, not retyped, so the two routes
// can never drift apart on brand.
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#6B6B7D";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const LINE = "#1F1F33";

/**
 * Exported so route.test.ts can assert the brand safety rule (E5-3, no gold
 * hex, no #0c0c18) against the constants actually in force here, rather than
 * a second hardcoded copy of the palette living only in the test.
 */
export const BRAND = { BG, BG_BASE, INK, INK_MUTED, INK_SUBTLE, PURPLE, CYAN, LINE };

/** Matches the league route's own validation (E5-5). */
export function isValidLeagueId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 64;
}

type CacheRow = {
  position: string;
  structural_demand: number;
  war_rank_1: number | null;
  war_at_demand: number | null;
  cliff_rank: number | null;
  curve: unknown;
};

const PULSE_POSITION_SET = new Set<string>(PULSE_POSITIONS);

function isPulsePosition(value: string): value is PulsePosition {
  return PULSE_POSITION_SET.has(value);
}

/**
 * Maps league_positional_war_cache rows to PositionCurve[], the same shape
 * buildChartGeometry() and the on-page chart both consume. Only the fields
 * the card and the geometry actually read are fetched; the rest of
 * PositionCurve's shape (replacementPoints, avgSeatedPoints, deficit,
 * shallowPool, weeklyDiagnostics) is unused here and filled with inert
 * defaults rather than queried.
 */
export function toPositionCurves(rows: CacheRow[]): PositionCurve[] {
  return rows
    .filter((row) => isPulsePosition(row.position))
    .map((row) => ({
      position: row.position as PulsePosition,
      structuralDemand: row.structural_demand,
      replacementPoints: null,
      avgSeatedPoints: null,
      deficit: null,
      shallowPool: false,
      warRank1: row.war_rank_1,
      warAtDemand: row.war_at_demand,
      cliffRank: row.cliff_rank,
      curve: Array.isArray(row.curve) ? (row.curve as WarCurvePoint[]) : [],
      weeklyDiagnostics: [],
    }));
}

/** The spoken and written name of a position. "DEF" alone reads as an abbreviation. */
const POSITION_LONG_NAME: Record<PulsePosition, string> = {
  QB: "Quarterback",
  RB: "Running back",
  WR: "Wide receiver",
  TE: "Tight end",
  K: "Kicker",
  DEF: "Defense",
};

/**
 * The card's one-sentence headline: "<Position> is the scarcest position in
 * this league." Uses selectScarcestAndDeepest() (imported, not
 * reimplemented) so this can never name a different position than the rail
 * summary card or the chart's own spoken summary would for the same league.
 * Returns null when nothing is plottable yet, matching
 * selectScarcestAndDeepest's own "nothing to say" case.
 */
export function buildHeadline(curves: PositionCurve[]): string | null {
  const { scarcest } = selectScarcestAndDeepest(curves);
  if (!scarcest) return null;
  return `${POSITION_LONG_NAME[scarcest.position]} is the scarcest position in this league.`;
}

export type LegendRow = { position: PulsePosition; label: string; color: string };

/**
 * One legend chip per plotted position, in canonical QB/RB/WR/TE/K/DEF order
 * regardless of the order rows came back from the database, so the card is
 * deterministic across requests for the same league.
 */
export function buildLegendRows(curves: PositionCurve[]): LegendRow[] {
  const byPosition = new Map(curves.map((c) => [c.position, c]));
  const rows: LegendRow[] = [];
  for (const position of PULSE_POSITIONS) {
    const curve = byPosition.get(position);
    if (!curve || curve.curve.length === 0) continue;
    const warLabel = curve.warAtDemand != null ? curve.warAtDemand.toFixed(2) : "-";
    rows.push({
      position,
      label: `${position} ${warLabel} (${curve.structuralDemand} start)`,
      color: POSITION_SERIES[position].color,
    });
  }
  return rows;
}

/**
 * Builds the SVG document string for the curve, reading every x, y, and path
 * off buildChartGeometry()'s output rather than recomputing anything (E5-2).
 * Uses the same POSITION_SERIES palette and markerPath() the on-page chart
 * uses, so the two can never draw a position in different colors or shapes.
 */
export function buildWarSvg(
  curves: PositionCurve[],
  geometry: ChartGeometry,
  width: number,
  height: number,
): string {
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  ];

  // A quiet baseline under the plot area, so the curve reads against
  // something even when the y-domain sits above zero.
  parts.push(
    `<line x1="${geometry.plot.left}" y1="${geometry.plot.bottom}" x2="${geometry.plot.right}" y2="${geometry.plot.bottom}" stroke="${LINE}" stroke-width="1" />`,
  );

  for (const series of geometry.series) {
    const style = POSITION_SERIES[series.position];
    const dashAttr = style.dash ? ` stroke-dasharray="${style.dash}"` : "";
    parts.push(
      `<path d="${series.d}" fill="none" stroke="${style.color}" stroke-width="3"${dashAttr} stroke-linecap="round" stroke-linejoin="round" />`,
    );
    if (series.markerAt) {
      const markerD = markerPath(style.marker, series.markerAt.x, series.markerAt.y, 7);
      parts.push(`<path d="${markerD}" fill="${style.color}" />`);
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

export function svgToDataUri(svg: string): string {
  const b64 = Buffer.from(svg, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}

export function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "...";
}

/** No cached curve for this league yet (E5-6). Always 200: this is a normal,
 * temporary state, not a fault. */
export function notReadyImage(leagueName: string, season: number): Response {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: BG,
          color: INK,
          fontFamily: "sans-serif",
        }}
      >
        <p style={{ fontSize: 48, fontWeight: 700, margin: 0 }}>FF Beacon</p>
        <p style={{ fontSize: 20, color: INK_MUTED, marginTop: 12 }}>
          {clip(leagueName, 60)}, {season}
        </p>
        <p style={{ fontSize: 24, color: INK_MUTED, marginTop: 16 }}>
          Positional WAR is still calculating.
        </p>
      </div>
    ),
    { ...SIZE, status: 200 },
  );
}

/** Matches the shape of the other three OG routes' notFoundImage helper. */
export function notFoundImage(reason: string): Response {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: BG,
          color: INK,
          fontFamily: "sans-serif",
        }}
      >
        <p style={{ fontSize: 48, fontWeight: 700, margin: 0 }}>FF Beacon</p>
        <p style={{ fontSize: 24, color: INK_MUTED, marginTop: 16 }}>{reason}</p>
      </div>
    ),
    { ...SIZE, status: 404 },
  );
}
