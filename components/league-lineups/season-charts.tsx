/**
 * The season, in two charts that answer two different questions.
 *
 *   WHAT YOU SCORED against WHAT YOU HAD    the gap is a decision.
 *   WHAT YOU SCORED against WHAT YOU WERE   the gap is variance, or the model
 *   PROJECTED FOR                           being wrong. Nobody's fault.
 *
 * Drawn apart rather than layered, because a reader who reads one gap as the
 * other comes away with the wrong idea about their own season, and that is the
 * single most common way a fantasy efficiency number gets misused.
 *
 * EVERY CHART HERE IS A PICTURE OF A TABLE THAT IS ALSO ON THE PAGE. The SVG is
 * `role="img"` with a one-sentence summary for its name, and the numbers behind
 * it sit under a disclosure as a real `<table>`, which is reachable by keyboard,
 * announced properly, selectable and copyable. A chart that is only an image is
 * a chart half this site's readers cannot use, and an sr-only table nobody can
 * see is worse than a visible one everybody can.
 *
 * COLOUR IS NEVER THE SIGNAL. The bars carry a shape (a short bar inside a tall
 * one is a gap; a bar below the line is a miss), every figure is in the table,
 * and the legend names each mark in words.
 *
 * WIDE CONTENT SCROLLS INSIDE ITSELF. Eighteen weeks on a 320px screen is not a
 * chart, so the plot has a minimum width and its own horizontal scroll, and the
 * page body never scrolls sideways. That is the same treatment every other wide
 * surface in League Pulse gets.
 *
 * Server components. No state, no interactivity, no client bundle.
 */

import { Activity, BarChart3 } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { fmtPoints, fmtSigned, pctLabel } from "@/components/league-schedule/format";
import { NOT_MEASURED } from "@/components/manager-ledger/format";
import { rollUpEfficiency } from "@/lib/league-lineups/season";
import type { ProjectionAccuracy, SeasonSeries, SeasonWeekPoint } from "@/lib/league-lineups/season";

/** Plot geometry. One set of numbers, so the two charts line up under each other. */
const PLOT = {
  height: 132,
  slotWidth: 34,
  barWidth: 18,
  minWidth: 320,
} as const;

function plotWidth(count: number): number {
  return Math.max(PLOT.minWidth, count * PLOT.slotWidth);
}

/**
 * The outcome tint for a week, used only as reinforcement: the table beside the
 * chart carries the result as a word.
 */
function outcomeFill(point: SeasonWeekPoint): string {
  if (point.outcome === "win") return "#22D3EE";
  if (point.outcome === "loss") return "#A855F7";
  return "#6B7280";
}

export function SeasonCharts({
  series,
  accuracy,
  viewedWeek,
  projectionSourceLabel,
}: {
  series: SeasonSeries;
  accuracy: ProjectionAccuracy | null;
  viewedWeek: number;
  projectionSourceLabel: string;
}) {
  const settled = series.points.filter((p) => p.scored !== null);
  const compared = series.points.filter((p) => p.scored !== null && p.projected !== null);

  return (
    <div className="space-y-6">
      <ScoredAgainstBest points={series.points} settledCount={settled.length} viewedWeek={viewedWeek} max={series.maxPoints} />
      <ProjectedAgainstActual
        points={compared}
        accuracy={accuracy}
        viewedWeek={viewedWeek}
        projectionSourceLabel={projectionSourceLabel}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ chart 1 */

function ScoredAgainstBest({
  points,
  settledCount,
  viewedWeek,
  max,
}: {
  points: SeasonWeekPoint[];
  settledCount: number;
  viewedWeek: number;
  max: number;
}) {
  const drawn = points.filter((p) => p.scored !== null);

  if (drawn.length === 0) {
    return (
      <Panel
        eyebrow="Season"
        title="What you scored against the best you had"
        helper="Fills in as weeks settle."
        headingLevel={3}
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          No week of this season has settled yet, so there is nothing to grade. This chart
          appears after your first completed week.
        </p>
      </Panel>
    );
  }

  const ceiling = Math.max(max, 1);
  const width = plotWidth(drawn.length);
  const scale = (value: number) => (value / ceiling) * PLOT.height;

  // THE GRADABLE PAIR, not scored over bestPossible. Those two include the
  // slots the optimiser cannot touch, which adds the same constant to both
  // halves and flatters every manager in an IDP league. It is also the figure
  // the season panel above and the table below both already quote, so deriving
  // it a second way would put three efficiencies on one screen.
  const seasonEfficiency = rollUpEfficiency(drawn);

  return (
    <Panel
      eyebrow="Season"
      title="What you scored against the best you had"
      helper="The tall bar is everything your roster could have produced that week. The solid bar is what you actually started."
      headingLevel={3}
    >
      <p className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-relaxed text-ink-muted">
        <span className="font-mono text-2xl font-extrabold tabular-nums text-brand-cyan sm:text-3xl">
          {seasonEfficiency === null ? (
            <>
              --
              {/* Two hyphens are swallowed at a screen reader's default
                  punctuation level, so the figure announces as nothing at all
                  and the sentence after it begins mid-air. */}
              <span className="sr-only">{NOT_MEASURED}</span>
            </>
          ) : (
            <>
              {pctLabel(seasonEfficiency)}
              <span className="sr-only"> of your roster&apos;s points started</span>
            </>
          )}
        </span>
        <span>
          {seasonEfficiency === null
            ? "Per-week efficiency fills in once this league's ledger has been rebuilt, which happens on your next visit to the Decisions page."
            : `of your own roster's points made it into your lineup across ${settledCount} settled ${settledCount === 1 ? "week" : "weeks"}.`}
        </span>
      </p>

      <ChartLegend
        items={[
          { swatch: "border border-dashed border-line-accent bg-transparent", label: "Best lineup available" },
          { swatch: "bg-brand-cyan", label: "What you started, in a week you won" },
          { swatch: "bg-brand-purple", label: "What you started, in a week you lost" },
        ]}
      />

      {/* A SCROLLING REGION HAS TO BE FOCUSABLE. Eighteen weeks is wider than
          the panel on any phone and most laptops, and a div with
          `overflow-x-auto` and no tabIndex cannot be scrolled by keyboard at
          all in Chrome, Edge or Safari. WCAG 2.1.1. */}
      <div
        tabIndex={0}
        role="region"
        aria-label="What you scored against the best you had, chart. Scroll horizontally to see every week."
        className="beacon-scroll mt-3 overflow-x-auto rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <svg
          role="img"
          aria-label={`Bar chart, ${drawn.length} settled weeks. Each week shows what your lineup scored inside an outline of the best lineup your roster could have produced. Week ${viewedWeek}, the one this page is showing, is outlined in cyan. The numbers are in the table below.`}
          viewBox={`0 0 ${width} ${PLOT.height + 26}`}
          width={width}
          height={PLOT.height + 26}
          className="block"
        >
          {drawn.map((point, index) => {
            const x = index * PLOT.slotWidth + (PLOT.slotWidth - PLOT.barWidth) / 2;
            const best = point.bestPossible ?? point.scored ?? 0;
            const scored = point.scored ?? 0;
            const bestH = scale(best);
            const scoredH = scale(scored);
            return (
              <g key={point.week}>
                {/* The ceiling, drawn as an outline so the empty part of it IS
                    the points that stayed on the bench. */}
                <rect
                  x={x}
                  y={PLOT.height - bestH}
                  width={PLOT.barWidth}
                  height={Math.max(bestH, 1)}
                  rx={3}
                  fill="none"
                  // #6B7280 rather than the line token: the EMPTY part of this
                  // outline is the points that stayed on the bench, which the
                  // panel helper tells the reader to look at, so at 1.4:1 the
                  // chart's whole premise was invisible to a low-vision reader.
                  // This is 3.9:1 against the panel ground. WCAG 1.4.11.
                  stroke={point.week === viewedWeek ? "#22D3EE" : "#6B7280"}
                  strokeDasharray="3 2"
                  strokeWidth={point.week === viewedWeek ? 2 : 1}
                />
                <rect
                  x={x}
                  y={PLOT.height - scoredH}
                  width={PLOT.barWidth}
                  height={Math.max(scoredH, 1)}
                  rx={3}
                  fill={outcomeFill(point)}
                  opacity={point.week === viewedWeek ? 1 : 0.72}
                />
                <text
                  x={x + PLOT.barWidth / 2}
                  y={PLOT.height + 16}
                  textAnchor="middle"
                  fontSize="9"
                  fill={point.week === viewedWeek ? "#22D3EE" : "#8A8AA3"}
                  fontWeight={point.week === viewedWeek ? 700 : 400}
                >
                  {point.week}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <ChartTable
        summary="Every settled week: what you scored, the best your roster could have produced, what stayed on your bench, and how the game went."
        label="behind the scored against best chart, week by week"
        head={["Week", "Scored", "Best available", "Left on bench", "Started", "Result"]}
        rows={drawn.map((p) => [
          String(p.week),
          fmtPoints(p.scored ?? 0),
          p.bestPossible === null ? "Not measured" : fmtPoints(p.bestPossible),
          p.leftOnBench === null ? "Not measured" : fmtPoints(p.leftOnBench),
          p.efficiency === null ? "Not measured" : pctLabel(p.efficiency),
          outcomeWords(p),
        ])}
        viewedRow={drawn.findIndex((p) => p.week === viewedWeek)}
      />
    </Panel>
  );
}

/** "Won", "Lost, and your bench would have won it", "No opponent". */
function outcomeWords(point: SeasonWeekPoint): string {
  if (point.outcome === null) return "No opponent";
  if (point.outcome === "win") return "Won";
  if (point.outcome === "tie") return "Tied";
  return point.bestOutcome === "win" ? "Lost, your bench would have won it" : "Lost";
}

/* ------------------------------------------------------------------ chart 2 */

function ProjectedAgainstActual({
  points,
  accuracy,
  viewedWeek,
  projectionSourceLabel,
}: {
  points: SeasonWeekPoint[];
  accuracy: ProjectionAccuracy | null;
  viewedWeek: number;
  projectionSourceLabel: string;
}) {
  if (points.length === 0 || accuracy === null) {
    return (
      <Panel
        eyebrow="Season"
        title="Projected against actual"
        helper="Fills in once a week has both a projection and a result."
        headingLevel={3}
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          No week of this season has both a stored projection and a settled score yet, so
          there is nothing to compare. This chart appears after your first completed week.
        </p>
      </Panel>
    );
  }

  // A DIVERGING BAR PER WEEK rather than two lines. The quantity a reader
  // actually wants is the MISS, and asking them to eyeball the distance between
  // two lines is asking them to do the subtraction. Above the line is a week
  // that beat its number; below it is one that did not.
  const misses = points.map((p) => (p.scored ?? 0) - (p.projected ?? 0));
  const reach = Math.max(1, ...misses.map((m) => Math.abs(m)));
  const width = plotWidth(points.length);
  const half = PLOT.height / 2;
  const scale = (value: number) => (Math.abs(value) / reach) * (half - 8);

  return (
    <Panel
      eyebrow="Season"
      title="Projected against actual"
      helper={`How far off the ${projectionSourceLabel} projection was, week by week. Above the line beat it, below missed it.`}
      headingLevel={3}
    >
      <p className="mb-3 text-sm leading-relaxed text-ink-muted">
        Your lineup beat its projection in{" "}
        <span className="font-semibold text-ink">
          {accuracy.beatWeeks} of {accuracy.weeks}
        </span>{" "}
        settled {accuracy.weeks === 1 ? "week" : "weeks"}, by an average of{" "}
        <span className="font-mono font-semibold text-ink">{fmtSigned(accuracy.meanDiff)}</span>{" "}
        points. The typical week landed{" "}
        <span className="font-mono font-semibold text-ink">{fmtPoints(accuracy.meanAbsDiff)}</span>{" "}
        points away from its number in one direction or the other.
      </p>

      <ChartLegend
        items={[
          { swatch: "bg-brand-cyan", label: "Beat the projection" },
          { swatch: "bg-signal-warning", label: "Missed it" },
        ]}
      />

      <div
        tabIndex={0}
        role="region"
        aria-label="Projected against actual, chart. Scroll horizontally to see every week."
        className="beacon-scroll mt-3 overflow-x-auto rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <svg
          role="img"
          aria-label={`Bar chart, ${points.length} settled weeks. Each bar is how far that week's actual score landed from its projection, above the line for a beat and below for a miss. Week ${viewedWeek}, the one this page is showing, is outlined. The numbers are in the table below.`}
          viewBox={`0 0 ${width} ${PLOT.height + 26}`}
          width={width}
          height={PLOT.height + 26}
          className="block"
        >
          {/* The zero line is what separates a beat from a miss, so it needs
              the same 3:1 the bars do. */}
          <line x1={0} y1={half} x2={width} y2={half} stroke="#6B7280" strokeWidth={1} />
          {points.map((point, index) => {
            const miss = misses[index];
            const h = Math.max(scale(miss), 1);
            const x = index * PLOT.slotWidth + (PLOT.slotWidth - PLOT.barWidth) / 2;
            const up = miss >= 0;
            return (
              <g key={point.week}>
                <rect
                  x={x}
                  y={up ? half - h : half}
                  width={PLOT.barWidth}
                  height={h}
                  rx={3}
                  fill={up ? "#22D3EE" : "#F59E0B"}
                  opacity={point.week === viewedWeek ? 1 : 0.72}
                  stroke={point.week === viewedWeek ? "#E8E8F0" : "none"}
                  strokeWidth={point.week === viewedWeek ? 1.5 : 0}
                />
                <text
                  x={x + PLOT.barWidth / 2}
                  y={PLOT.height + 16}
                  textAnchor="middle"
                  fontSize="9"
                  fill={point.week === viewedWeek ? "#22D3EE" : "#8A8AA3"}
                  fontWeight={point.week === viewedWeek ? 700 : 400}
                >
                  {point.week}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <ChartTable
        summary="Every settled week: what your lineup was projected for, what it scored, and the difference."
        label="behind the projected against actual chart, week by week"
        head={["Week", "Projected", "Scored", "Difference"]}
        rows={points.map((p, i) => [
          String(p.week),
          fmtPoints(p.projected ?? 0),
          fmtPoints(p.scored ?? 0),
          fmtSigned(misses[i]),
        ])}
        viewedRow={points.findIndex((p) => p.week === viewedWeek)}
      />

      <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
        A past week&apos;s projection is rebuilt from the number published for that week,
        adjusted with today&apos;s opponent and reliability figures rather than the ones in
        force at the time, and resolved to one engine across the whole season rather than
        week by week. It is a fair read on whether the model was about right, not a
        snapshot of what this page showed that Sunday.
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ shared */

function ChartLegend({ items }: { items: { swatch: string; label: string }[] }) {
  return (
    <ul role="list" className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${item.swatch}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The numbers behind a chart, as a real table under a disclosure.
 *
 * VISIBLE RATHER THAN `sr-only`, because a table of a season's scores is
 * something a sighted reader wants too: it is selectable, copyable, and exact
 * in a way a 18 pixel bar is not. Closed by default so it does not push the
 * next chart off the screen.
 */
function ChartTable({
  summary,
  label,
  head,
  rows,
  viewedRow,
}: {
  summary: string;
  /**
   * What this disclosure opens, appended out loud.
   *
   * Both charts had a summary reading "See the numbers", which is two
   * indistinguishable entries in a list of the page's controls.
   */
  label: string;
  head: string[];
  rows: string[][];
  /** Index of the week the page is showing, so it is marked in the table too. */
  viewedRow: number;
}) {
  return (
    <details className="mt-3 rounded-card border border-line bg-base/40">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-[12px] font-semibold text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
        <BarChart3 aria-hidden="true" className="h-3.5 w-3.5" />
        See the numbers
        <span className="sr-only"> {label}</span>
      </summary>
      <div
        tabIndex={0}
        role="region"
        aria-label={`Table, ${label}. Scroll horizontally to see every column.`}
        className="beacon-scroll overflow-x-auto px-1 pb-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <table className="w-full text-xs">
          <caption className="sr-only">{summary}</caption>
          <thead className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              {head.map((h, i) => (
                <th key={h} scope="col" className={i === 0 ? "px-2 py-1.5 text-left" : "px-2 py-1.5 text-right"}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, index) => (
              <tr key={row[0]} className={index === viewedRow ? "bg-brand-cyan/10" : ""}>
                <th scope="row" className="px-2 py-1.5 text-left font-semibold text-ink">
                  {row[0]}
                  {index === viewedRow && <span className="sr-only">, the week you are viewing</span>}
                </th>
                {row.slice(1).map((cell, i) => (
                  <td key={i} className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-muted">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** The one-line season standing, for the report header. */
export function SeasonStandingLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm leading-relaxed text-ink-muted">
      <Activity aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
      <span>{children}</span>
    </p>
  );
}
