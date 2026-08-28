"use client";

/**
 * The Positional WAR dashboard: two charts and a player table, driven by one
 * position filter.
 *
 * WHY THE STATE LIVES HERE. The line chart, the scatterplot and the table all
 * answer questions about the same set of players, so a reader who decides
 * kickers are not the point should say it once. Three independent filters
 * would let the three surfaces show three different populations while looking
 * like one view, which is the failure mode a dashboard exists to avoid.
 *
 * THE TABLE IS THE DATA TABLE FOR BOTH CHARTS. Neither <svg> is in the
 * accessibility tree; every figure either chart draws is in the table below
 * them, in more detail, as real rows and cells. That is why neither chart
 * carries its own duplicate <details> table: there would be three copies of
 * the same numbers on one page, and two of them would be shorter.
 *
 * Layout: side by side from xl, stacked below it. Two line charts at half a
 * laptop's width are unreadable, and this is exactly the breakpoint the League
 * Pulse overview already splits its own two-column layout at.
 */

import { useMemo, useState } from "react";
import { POSITION_SERIES } from "@/components/chart-kit";
import { SeriesToggleLegend, type SeriesToggleItem } from "@/components/chart-kit-legend";
import { flattenWarRows, type WarDashboardPosition } from "@/lib/positional-war/table";
import { defaultVisiblePositions, type WarAxisMode } from "@/lib/positional-war/chart-geometry";
import { describeTrend, buildScatterGeometry } from "@/lib/positional-war/scatter-geometry";
import {
  describeTierScale,
  WAR_TIERS,
  WAR_TIER_LABEL,
  WAR_TIER_MEANING,
  type WarTierScale,
} from "@/lib/positional-war/tiers";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { PositionalWarChart } from "./positional-war-chart";
import { WarScatterChart } from "./war-scatter-chart";
import { WarPlayerTable } from "./war-player-table";
import { buildLegendHeadline } from "./summary";

/**
 * Geometry dimensions used only to work out the trend sentence on the server
 * side of the render. The real chart measures its own container; this fit is
 * scale-invariant (a least-squares slope on the DATA, not on pixels), so any
 * box gives the same r squared.
 */
const TREND_PROBE = { width: 640, height: 360, padding: { t: 14, r: 18, b: 34, l: 42 } };

export function WarDashboard({
  positions,
  axisMode,
  maxRank,
  tierScale,
  chartSummary,
  leagueName,
  sourceDisplay,
  formatDisplay,
}: {
  positions: WarDashboardPosition[];
  axisMode: WarAxisMode;
  maxRank: number;
  tierScale: WarTierScale | null;
  /** The spoken conclusion for the line chart, built server-side in summary.ts. */
  chartSummary: string;
  leagueName: string;
  sourceDisplay: string;
  formatDisplay: string;
}) {
  const plottable = useMemo(() => positions.filter((p) => p.curve.length > 0), [positions]);

  const [visible, setVisible] = useState<Set<PulsePosition>>(() =>
    defaultVisiblePositions(plottable),
  );

  const toggle = (position: PulsePosition) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  };

  const allRows = useMemo(() => flattenWarRows(plottable), [plottable]);
  const visibleRows = useMemo(
    () => allRows.filter((row) => visible.has(row.position)),
    [allRows, visible],
  );

  const legendItems: SeriesToggleItem[] = plottable.map((curve) => ({
    id: curve.position,
    style: POSITION_SERIES[curve.position],
    label: curve.position,
    headline: buildLegendHeadline(curve),
    pressed: visible.has(curve.position),
  }));

  // The trend sentence and the omitted count, computed from the same pure
  // geometry the scatter component draws, so the prose and the picture cannot
  // disagree about how many players are plotted.
  const scatterFacts = useMemo(() => {
    const geometry = buildScatterGeometry({ rows: visibleRows, ...TREND_PROBE });
    return { trend: describeTrend(geometry.trend), omitted: geometry.omittedCount, plotted: geometry.points.length };
  }, [visibleRows]);

  const activeList =
    visible.size === 0
      ? "none"
      : plottable
          .filter((p) => visible.has(p.position))
          .map((p) => p.position)
          .join(", ");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-ink">Positions</h3>
        <p className="mt-0.5 text-xs text-ink-muted">
          One filter for both charts and the table. Currently showing {activeList}.
        </p>
        <div className="mt-2">
          <SeriesToggleLegend items={legendItems} onToggle={(id) => toggle(id as PulsePosition)} />
        </div>
      </div>

      {visible.size === 0 ? (
        <p className="rounded-card border border-line bg-base/40 p-6 text-sm text-ink-muted">
          Every position is hidden. Turn one back on above to see the charts and the table.
        </p>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <figure className="min-w-0 rounded-card border border-line bg-base/40 p-4">
              <figcaption>
                <h3 className="text-sm font-semibold text-ink">Wins over replacement</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                  How much each position drops off. A steep line runs out fast; a flat one means the
                  next player down is nearly as good.
                </p>
              </figcaption>
              {/* The conclusion, in reading order, before the graphic it describes. */}
              <p className="sr-only">{chartSummary}</p>
              <div className="mt-3">
                <PositionalWarChart
                  curves={plottable}
                  axisMode={axisMode}
                  maxRank={maxRank}
                  visible={visible}
                  onToggleSeries={toggle}
                  legend={false}
                />
              </div>
            </figure>

            <figure className="min-w-0 rounded-card border border-line bg-base/40 p-4">
              <figcaption>
                <h3 className="text-sm font-semibold text-ink">Trade value against wins</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                  What the market charges, against what a player is worth in this league. Value from{" "}
                  {sourceDisplay} at {formatDisplay}.
                </p>
              </figcaption>
              <p className="sr-only">
                {`One dot per player. ${scatterFacts.plotted} plotted. Left to right is trade value, low to high; bottom to top is wins over replacement. A player high and to the left wins games and costs little.`}
              </p>
              <div className="mt-3">
                <WarScatterChart rows={visibleRows} />
              </div>
              {scatterFacts.trend && (
                <p className="mt-2 text-xs leading-relaxed text-ink-subtle">{scatterFacts.trend}</p>
              )}
              {scatterFacts.omitted > 0 && (
                <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
                  {scatterFacts.omitted} {scatterFacts.omitted === 1 ? "player has" : "players have"}{" "}
                  no current value from {sourceDisplay}, so {scatterFacts.omitted === 1 ? "he is" : "they are"}{" "}
                  not plotted here. {scatterFacts.omitted === 1 ? "He is" : "They are"} still in the
                  table below.
                </p>
              )}
            </figure>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">Every plotted player</h3>
            <p className="mt-0.5 text-xs text-ink-muted">{describeTierScale(tierScale)}</p>
            <div className="mt-3">
              <WarPlayerTable
                rows={allRows}
                positions={visible}
                leagueName={leagueName}
                sourceDisplay={sourceDisplay}
              />
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              {WAR_TIERS.map((tier) => (
                <div key={tier} className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="font-semibold text-ink">{WAR_TIER_LABEL[tier]}</dt>
                  <dd className="text-ink-muted">{WAR_TIER_MEANING[tier]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
    </div>
  );
}
