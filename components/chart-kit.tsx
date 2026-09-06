/**
 * Shared chart furniture for the Beacon Breakdown.
 *
 * Hand-rolled SVG, no charting dependency, matching components/player-profile/
 * value-trend-chart.tsx. The project has never carried a chart library and does
 * not need one for a line, a strip, or a bar.
 *
 * Every chart is wrapped in ChartFigure, which enforces three things a screen
 * reader needs and a raw <svg> does not give you:
 *
 *   1. A spoken summary that states the CONCLUSION, not the shape. "Player A
 *      projects for 141 points to Player B's 118" is useful; "line chart with
 *      two series" is not.
 *   2. A real data table, always in the DOM, inside a <details> anyone can open.
 *      Sighted keyboard users get the numbers too, not just assistive tech.
 *   3. A visible caption, so the chart is never the only place the point is made.
 *
 * WHY THE SUMMARY IS A PARAGRAPH AND NOT role="img".
 *   The obvious build is a role="img" host carrying the summary as its
 *   aria-label. That is right for a pure <svg> and actively wrong for the rest of
 *   these charts, because role="img" makes every descendant presentational. Half
 *   the charts here are built from divs and list items with real text in them
 *   (the schedule strip's opponent codes, the boom/bust counts, the weekly start
 *   grid), and wrapping those in role="img" would delete all of it from the
 *   accessibility tree and leave one sentence in its place. So the summary is a
 *   visually hidden paragraph, the SVG-based charts mark their own <svg>
 *   aria-hidden, and the DOM-based ones keep every label they render.
 *
 * Nothing here encodes meaning in color alone. Series carry a distinguishing
 * dash pattern and a marker shape as well as a hue, and every legend entry names
 * its player in text.
 *
 * WHY THIS MODULE LIVES OUTSIDE app/tools/beacon-breakdown.
 *   This started as furniture for one tool and lived at
 *   app/tools/beacon-breakdown/chart-kit.tsx. League Pulse's Positional WAR
 *   chart needs the same accessibility contract (ChartFigure's summary/table/
 *   caption trio applies unchanged), and importing a component across an app
 *   route boundary is the wrong dependency direction: a route directory is not
 *   a module other routes should reach into. So the furniture moved to
 *   components/, which both features import from, and the original path became
 *   a pure re-export so the Beacon Breakdown tool did not have to change.
 */

import type { ReactNode } from "react";
import type { PulsePosition } from "@/lib/power-pulse/types";

/** Player A is purple, player B is cyan, everywhere in the tool. */
export const SERIES_A = "#A855F7";
export const SERIES_B = "#22D3EE";

export function ChartFigure({
  title,
  description,
  summary,
  table,
  tableLabel = "View the numbers behind this chart",
  titleLevel = 4,
  children,
}: {
  title: string;
  description?: string;
  /** A sentence stating what the chart shows. Read alongside the graphic. */
  summary: string;
  /** A real <table> of the plotted values. */
  table: ReactNode;
  tableLabel?: string;
  /**
   * Heading level for the figure's own title.
   *
   * Defaults to 4, which is right for the Beacon Breakdown, where every chart
   * sits under an h3 section heading. A caller placing this directly inside an
   * h2 Panel has to pass 3, or the document skips a level and a reader
   * navigating by heading hits an unexplained jump. Never hardcode this back.
   */
  titleLevel?: 3 | 4 | 5;
  children: ReactNode;
}) {
  const Title = (`h${titleLevel}` as const) as "h3" | "h4" | "h5";
  return (
    <figure className="rounded-card border border-line bg-base/40 p-4">
      <figcaption>
        <Title className="text-sm font-semibold text-ink">{title}</Title>
        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>
        )}
      </figcaption>

      {/* The conclusion, in reading order, before the graphic it describes. */}
      <p className="sr-only">{summary}</p>

      <div className="mt-3">{children}</div>

      <details className="mt-3 group">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-medium text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
          {tableLabel}
        </summary>
        <div className="mt-2 overflow-x-auto">{table}</div>
      </details>
    </figure>
  );
}

/** The two-player legend that sits above a chart. Names, not just colors. */
export function SeriesLegend({
  aName,
  bName,
}: {
  aName: string;
  bName: string;
}) {
  return (
    <ul role="list" className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium">
      <li className="flex items-center gap-1.5 text-brand-purple">
        <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8" className="pointer-events-none">
          <line x1="0" y1="4" x2="18" y2="4" stroke={SERIES_A} strokeWidth="2" />
          <circle cx="9" cy="4" r="3" fill={SERIES_A} />
        </svg>
        {aName}
      </li>
      <li className="flex items-center gap-1.5 text-brand-cyan">
        <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8" className="pointer-events-none">
          <line
            x1="0"
            y1="4"
            x2="18"
            y2="4"
            stroke={SERIES_B}
            strokeWidth="2"
            strokeDasharray="4 3"
          />
          <rect x="6" y="1" width="6" height="6" fill={SERIES_B} />
        </svg>
        {bName}
      </li>
    </ul>
  );
}

/** A compact table shell with the project's border and spacing conventions. */
export function DataTable({
  caption,
  head,
  children,
}: {
  caption: string;
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <table className="w-full min-w-[18rem] border-collapse text-left text-xs">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-subtle">
          {head}
        </tr>
      </thead>
      <tbody className="divide-y divide-line/60">{children}</tbody>
    </table>
  );
}

export function Th({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <th scope="col" className={`py-1.5 pr-3 font-semibold ${numeric ? "text-right" : ""}`}>
      {children}
    </th>
  );
}

export function Td({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <td className={`py-1.5 pr-3 text-ink-muted ${numeric ? "text-right tabular-nums" : ""}`}>
      {children}
    </td>
  );
}

/** Build an SVG polyline path from already-scaled points. */
export function linePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

/**
 * A linear scale with a tiny guard for flat series. A series where every value
 * is identical would otherwise divide by zero and collapse onto one edge.
 */
export function makeScale(min: number, max: number, from: number, to: number) {
  const span = max - min;
  if (span <= 0) {
    const mid = (from + to) / 2;
    return () => mid;
  }
  return (v: number) => from + ((v - min) / span) * (to - from);
}

/**
 * The empty state a chart renders instead of an axis with nothing on it. Says
 * what is missing and why, rather than showing a blank frame.
 */
export function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-card border border-dashed border-line bg-base/40 px-4 py-6 text-sm text-ink-muted">
      {children}
    </p>
  );
}

/* -----------------------------------------------------------------------
 * Six-series categorical palette (Positional WAR)
 * -------------------------------------------------------------------- */

/**
 * A series's full visual identity: a hue, a dash pattern, and a marker shape.
 * Color is never the only channel carrying identity. Remove color entirely
 * (grayscale, forced-colors mode, a printed page) and every series still reads
 * as distinct from its dash pattern and its marker.
 */
export type SeriesStyle = {
  /** Hex stroke/fill color. */
  color: string;
  /** SVG stroke-dasharray, or null for a solid line. */
  dash: string | null;
  marker: "circle" | "square" | "diamond" | "triangle" | "cross" | "star";
};

/**
 * The Positional WAR palette. Chosen per the dataviz skill's color formula:
 * a fixed categorical order (never cycled), each hue picked for the job of
 * carrying series identity, dash and marker carrying the same identity a
 * second way.
 *
 * QB and RB are pinned to the two FF Beacon brand colors (purple, cyan) rather
 * than assigned by rank, so they never move between leagues. The other four
 * were chosen and verified with the skill's validator
 * (dataviz/scripts/validate_palette.js) against this project's actual dark
 * surface: bg-surface/50 (#0F0F1A at 50%) composited over bg-base (#07070D)
 * resolves to #0B0B14, which is the surface every ratio below is measured
 * against, not the validator's lighter #1a1a19 default.
 *
 * Contrast is checked at the plan's own bar (WCAG AA text contrast, 4.5:1
 * minimum, per docs/league-pulse/league-pulse-positional-war-plan.md section 11.4), which
 * is stricter than the dataviz skill's 3:1 mark-contrast relief band. All six
 * clear 4.5:1; five of six clear AAA (7:1). QB is brand-fixed purple and
 * clears AA only (4.95:1), which the plan anticipates ("AAA where the hue
 * allows").
 *
 * Validator results for this exact set, order QB/RB/WR/TE/K/DEF, adjacent
 * pairs (the skill's default pairing rule for line and bar charts):
 *   - CVD separation:      PASS, worst adjacent pair K<->TE, DeltaE 17.4 (protan),
 *                           target is 8.0
 *   - Normal-vision floor: PASS, worst adjacent pair K<->TE, DeltaE 26.9,
 *                           floor is 15.0
 *   - Chroma floor:        PASS, all six >= 0.10 OKLCH C
 *   - Lightness band:      FAIL against the skill's default dark band
 *                           (OKLCH L 0.48-0.67). This is a deliberate,
 *                           documented deviation: that band is tuned to the
 *                           skill's own #1a1a19 reference dark surface, and
 *                           this project's near-black composited panel
 *                           (#0B0B14) needs lighter, higher-L colors to clear
 *                           the plan's mandatory 4.5:1 AA text contrast. The
 *                           checks that actually predict confusability (CVD
 *                           separation, the normal-vision floor, chroma) all
 *                           pass with wide margins, which is why this
 *                           deviation is accepted rather than reworked.
 *   - All-pairs (informational only; the skill scopes line charts to adjacent
 *     pairs, not all-pairs): WR<->K sits at DeltaE 9.5 under simulated CVD
 *     (still above the 8.0 target) but 12.5 under normal vision (below the
 *     15.0 floor), since both are warm orange/rose hues and Positional WAR's
 *     six curves can cross so any two series can end up visually adjacent.
 *     Every attempted reassignment that fixed this pair broke an adjacent
 *     pair elsewhere (RB's cyan and TE's blue collapse together once TE
 *     moves), which matches the skill's own note that six-plus series rarely
 *     clear an all-pairs gate. The mandatory per-series dash pattern and
 *     marker shape below is the sanctioned mitigation for this residual risk
 *     ("legal only with secondary encoding"), and every series ships both.
 */
export const POSITION_SERIES: Record<PulsePosition, SeriesStyle> = {
  // Brand purple, fixed. Contrast vs #0B0B14: 4.95:1 (AA).
  QB: { color: "#A855F7", dash: null, marker: "circle" },
  // Brand cyan, fixed. Contrast vs #0B0B14: 10.84:1 (AAA).
  RB: { color: "#22D3EE", dash: "8 4", marker: "square" },
  // Orange. Contrast vs #0B0B14: 8.65:1 (AAA).
  WR: { color: "#FB923C", dash: "2 3", marker: "diamond" },
  // Blue. Contrast vs #0B0B14: 7.70:1 (AAA).
  TE: { color: "#60A5FA", dash: "6 2 2 2", marker: "triangle" },
  // Rose. Contrast vs #0B0B14: 7.28:1 (AAA).
  K: { color: "#FB7185", dash: "1 4", marker: "cross" },
  // Yellow. Contrast vs #0B0B14: 14.86:1 (AAA).
  DEF: { color: "#FDE047", dash: "10 3 2 3 2 3", marker: "star" },
};

/**
 * SVG path `d` for one marker shape, centered at (cx, cy) with characteristic
 * size r. Returns a closed, fillable path so the chart's <svg> and the OG
 * route's Satori-rendered <svg> draw the exact same shape from the exact same
 * data: no charting library, no Tailwind, plain geometry either side can read.
 */
export function markerPath(marker: SeriesStyle["marker"], cx: number, cy: number, r: number): string {
  switch (marker) {
    case "circle": {
      // Two half-circle arcs, a common trick for a circle as a filled path.
      return `M${(cx - r).toFixed(2)},${cy.toFixed(2)} a${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(2 * r).toFixed(2)},0 a${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(-2 * r).toFixed(2)},0 Z`;
    }
    case "square": {
      // Half-side chosen so the square's area roughly matches the circle's.
      const h = r * 0.886;
      return `M${(cx - h).toFixed(2)},${(cy - h).toFixed(2)} L${(cx + h).toFixed(2)},${(cy - h).toFixed(2)} L${(cx + h).toFixed(2)},${(cy + h).toFixed(2)} L${(cx - h).toFixed(2)},${(cy + h).toFixed(2)} Z`;
    }
    case "diamond": {
      const d = r * 1.2;
      return `M${cx.toFixed(2)},${(cy - d).toFixed(2)} L${(cx + d).toFixed(2)},${cy.toFixed(2)} L${cx.toFixed(2)},${(cy + d).toFixed(2)} L${(cx - d).toFixed(2)},${cy.toFixed(2)} Z`;
    }
    case "triangle": {
      const rad = r * 1.3;
      const x1 = cx + rad * Math.cos((-90 * Math.PI) / 180);
      const y1 = cy + rad * Math.sin((-90 * Math.PI) / 180);
      const x2 = cx + rad * Math.cos((30 * Math.PI) / 180);
      const y2 = cy + rad * Math.sin((30 * Math.PI) / 180);
      const x3 = cx + rad * Math.cos((150 * Math.PI) / 180);
      const y3 = cy + rad * Math.sin((150 * Math.PI) / 180);
      return `M${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} Z`;
    }
    case "cross": {
      const outer = r * 1.15;
      const t = r * 0.4;
      const pts: [number, number][] = [
        [cx - t, cy - outer],
        [cx + t, cy - outer],
        [cx + t, cy - t],
        [cx + outer, cy - t],
        [cx + outer, cy + t],
        [cx + t, cy + t],
        [cx + t, cy + outer],
        [cx - t, cy + outer],
        [cx - t, cy + t],
        [cx - outer, cy + t],
        [cx - outer, cy - t],
        [cx - t, cy - t],
      ];
      return `M${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L")} Z`;
    }
    case "star": {
      const outerR = r * 1.35;
      const innerR = outerR * 0.5;
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? outerR : innerR;
        // Start pointing straight up, then step 36 degrees per point.
        const angle = (-90 + i * 36) * (Math.PI / 180);
        pts.push([cx + rad * Math.cos(angle), cy + rad * Math.sin(angle)]);
      }
      return `M${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L")} Z`;
    }
    default: {
      const exhaustive: never = marker;
      return exhaustive;
    }
  }
}
