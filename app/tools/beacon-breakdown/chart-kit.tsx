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
 */

import type { ReactNode } from "react";

/** Player A is purple, player B is cyan, everywhere in the tool. */
export const SERIES_A = "#A855F7";
export const SERIES_B = "#22D3EE";

export function ChartFigure({
  title,
  description,
  summary,
  table,
  tableLabel = "View the numbers behind this chart",
  children,
}: {
  title: string;
  description?: string;
  /** A sentence stating what the chart shows. Read alongside the graphic. */
  summary: string;
  /** A real <table> of the plotted values. */
  table: ReactNode;
  tableLabel?: string;
  children: ReactNode;
}) {
  return (
    <figure className="rounded-card border border-line bg-base/40 p-4">
      <figcaption>
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
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
        <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8">
          <line x1="0" y1="4" x2="18" y2="4" stroke={SERIES_A} strokeWidth="2" />
          <circle cx="9" cy="4" r="3" fill={SERIES_A} />
        </svg>
        {aName}
      </li>
      <li className="flex items-center gap-1.5 text-brand-cyan">
        <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8">
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
