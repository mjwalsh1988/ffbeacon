/**
 * The League Overview rail's Positional WAR card: the scarcity chart,
 * condensed.
 *
 * WHAT CHANGED, AND WHY. This card used to be three lines of prose. It named
 * the scarcest and the flattest position and stopped, which meant a reader had
 * to open another page to learn anything about the other four. It now carries
 * the same shape the dedicated page's first chart carries: a sparkline of every
 * position's curve, and a row per position with the figure and the starting
 * count beside it. The full chart is still a page away, with thirty-six ranks,
 * the scatterplot and the player table; this is the glance.
 *
 * THE SPARKLINE IS THE SAME GEOMETRY THE FULL CHART DRAWS. It calls
 * buildChartGeometry() with a small box and a shallow rank cap, exactly the way
 * the on-page chart and the OG card do, so the rail cannot disagree with the
 * page it links to about the shape of a league. It is aria-hidden and carries
 * no axis: every figure it plots is in the table beneath it, as real cells.
 *
 * COLOUR CARRIES NOTHING ON ITS OWN. Each row shows the position's series
 * colour AND its marker shape (the same circle, square, diamond, triangle,
 * cross and star the chart uses) AND its name in text, and the bar behind each
 * figure is the same number that is printed on top of it.
 *
 * Reads through the same React cache()-wrapped loadPositionalWarView the rest
 * of the feature uses, so a render that mounts this alongside another consumer
 * of the same curve issues one query rather than two.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { Panel } from "@/components/dashboard-panel";
import { markerPath, POSITION_SERIES } from "@/components/chart-kit";
import { buildChartGeometry } from "@/lib/positional-war/chart-geometry";
import { matchViewerRoster } from "@/lib/league-viewer";
import {
  loadPositionalWarView,
  loadViewerCandidates,
  loadViewerOverlay,
  resolveUnmatchedOwnerInfo,
} from "@/lib/league-positional-war-data";
import type { PlottableCurve } from "@/lib/positional-war/types";
import { matchCurveOwnership, splitUnmatchedOwners } from "./overlay";
import { buildYourBestLine, selectScarcestAndDeepest } from "./selection";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * How deep the sparkline plots.
 *
 * Twelve ranks, not thirty-six. The rail is 340px wide, so a thirty-six point
 * series is drawn at eight pixels a player and the drop-off that the card
 * exists to show flattens into the noise. Twelve covers the steep part of every
 * position's curve, which is the part that differs between positions. The card
 * says so in its helper text rather than leaving the reader to assume it is the
 * whole picture.
 */
const RAIL_MAX_RANK = 12;

/** A small coordinate space. No axis labels, so the padding is only stroke room. */
const RAIL_BOX = {
  width: 300,
  height: 76,
  padding: { t: 8, r: 6, b: 8, l: 6 },
};

const POSITION_NAME: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running back",
  WR: "Wide receiver",
  TE: "Tight end",
  K: "Kicker",
  DEF: "Team defense",
};

/**
 * The rows, ordered by what the best player at each position is worth.
 *
 * Descending, so the hardest position to replace in this league leads. That
 * ordering is the finding: it is the same ranking selectScarcestAndDeepest
 * makes for the headline, applied to every position rather than to the two ends
 * of it.
 */
function buildRows(curves: readonly PlottableCurve[]) {
  return curves
    .filter((c) => c.curve.length > 0 && c.warRank1 !== null)
    .map((c) => ({
      position: c.position,
      war: c.warRank1 as number,
      demand: c.structuralDemand,
    }))
    .sort((a, b) => b.war - a.war);
}

export async function WarRailSummary({
  supabase,
  leagueRowId,
  season,
  searchedUsername,
  viewerSleeperUserId,
  focusedRosterId,
  positionalWarHref,
}: {
  supabase: AnySupabase;
  leagueRowId: string;
  season: number;
  searchedUsername: string | null;
  /** The viewer's Sleeper user id, which matchViewerRoster tries before the
   *  handle: a saved handle is a Sleeper username and the candidates carry
   *  display names, and Sleeper lets the two differ. */
  viewerSleeperUserId: string | null;
  focusedRosterId: number | null;
  /** Where "Explore Positional WAR" goes, with the searched handle forwarded. */
  positionalWarHref: string;
}) {
  const [view, candidates] = await Promise.all([
    loadPositionalWarView(supabase, leagueRowId, season),
    loadViewerCandidates(supabase, leagueRowId),
  ]);

  // No cached curve, or rows that exist but hold no plotted players: no card at
  // all. An empty finding card is worse than no card, and the Positional WAR
  // page itself carries the honest reason.
  if (!view || view.curves.every((c) => c.curve.length === 0)) return null;
  if (view.status === "settled" || view.status === "error") return null;

  const { scarcest, deepest } = selectScarcestAndDeepest(view.curves);
  if (!scarcest) return null;

  const rows = buildRows(view.curves);
  if (rows.length === 0) return null;
  const topWar = rows[0].war;

  const plottable = view.curves.filter((c) => c.curve.length > 0);
  const geometry = buildChartGeometry({
    curves: plottable,
    mode: "rank",
    maxRank: RAIL_MAX_RANK,
    ...RAIL_BOX,
  });

  let yourBestLine: string | null = null;
  const rosterId = matchViewerRoster(
    candidates,
    searchedUsername,
    focusedRosterId,
    viewerSleeperUserId,
  );
  if (rosterId !== null) {
    const overlay = await loadViewerOverlay(supabase, leagueRowId, rosterId);
    if (overlay) {
      const ownership = matchCurveOwnership(view.curves, overlay.ownedSleeperIds);
      const best = ownership.matchedByPosition.get(scarcest.position)?.[0] ?? null;
      let hasOneAtScarcest = false;
      if (!best && ownership.unmatchedOwnedIds.length > 0) {
        const info = await resolveUnmatchedOwnerInfo(supabase, ownership.unmatchedOwnedIds);
        const split = splitUnmatchedOwners(ownership.unmatchedOwnedIds, info);
        hasOneAtScarcest = split.pastDepth.some((p) => p.position === scarcest.position);
      }
      yourBestLine = buildYourBestLine(scarcest.position, best, hasOneAtScarcest);
    }
  }

  const headline = deepest
    ? `${POSITION_NAME[scarcest.position]} is hardest to replace here, ${POSITION_NAME[deepest.position].toLowerCase()} easiest.`
    : `${POSITION_NAME[scarcest.position]} is hardest to replace here.`;

  return (
    // The heading names the CARD, not the metric, so a reader scanning the
    // heading list can tell it apart from the full panel on the page it links
    // to. The differentiating word lives in the eyebrow.
    <Panel eyebrow="Scarcity" title="Positional WAR at a glance" bodyClassName="px-4 py-4 sm:px-5">
      <p className="text-xs leading-relaxed text-ink-muted">{headline}</p>

      {/* The condensed curve. Decorative: every value it draws is a cell in the
          table below, and the table is what a screen reader reads. */}
      <div
        aria-hidden="true"
        className="pointer-events-none mt-3 rounded-card border border-line bg-base/50 p-1"
      >
        <svg
          viewBox={`0 0 ${RAIL_BOX.width} ${RAIL_BOX.height}`}
          preserveAspectRatio="none"
          className="h-16 w-full"
        >
          {geometry.zeroY !== null && (
            <line
              x1={geometry.plot.left}
              y1={geometry.zeroY}
              x2={geometry.plot.right}
              y2={geometry.zeroY}
              stroke="#2A2A40"
              strokeWidth="1"
            />
          )}
          {geometry.series.map((series) => {
            const style = POSITION_SERIES[series.position];
            return (
              <path
                key={series.position}
                d={series.d}
                fill="none"
                stroke={style.color}
                strokeWidth="2"
                strokeDasharray={style.dash ?? undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      </div>

      <table className="mt-3 w-full border-collapse text-xs">
        <caption className="sr-only">
          The best player at each position, in matchups over replacement, and how many of that
          position this league starts. Ordered by what the best one is worth.
        </caption>
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.1em] text-ink-subtle">
            <th scope="col" className="pb-1 text-left font-semibold">
              Position
            </th>
            <th scope="col" className="pb-1 text-right font-semibold">
              Best one adds
            </th>
            <th scope="col" className="pb-1 pl-2 text-right font-semibold">
              <span aria-hidden="true">Start</span>
              <span className="sr-only">How many this league starts</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const style = POSITION_SERIES[row.position];
            // Relative to the most valuable position in this league, so the
            // bars compare within the card and never imply a scale that is not
            // there. Floored so a position worth almost nothing still shows a
            // sliver rather than vanishing.
            const fill = topWar > 0 ? Math.max(4, Math.round((row.war / topWar) * 100)) : 0;
            return (
              <tr key={row.position}>
                <th scope="row" className="py-1 pr-2 text-left font-medium text-ink">
                  <span className="flex items-center gap-1.5">
                    {/* The series marker, same shape and colour the chart uses,
                        so the row and the line above it are recognisably the
                        same position. Decorative: the label beside it is the
                        name. */}
                    <svg
                      aria-hidden="true"
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      className="pointer-events-none shrink-0"
                    >
                      <path d={markerPath(style.marker, 6, 6, 3.2)} fill={style.color} />
                    </svg>
                    {row.position}
                  </span>
                </th>
                <td className="py-1">
                  {/* The bar sits behind the figure rather than beside it, so a
                      340px rail spends its width on the number. */}
                  <span className="relative flex h-5 items-center justify-end overflow-hidden rounded-[4px] bg-base/60 px-1.5">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 left-0 rounded-[4px]"
                      style={{
                        width: `${fill}%`,
                        backgroundImage: `linear-gradient(90deg, ${style.color}22 0%, ${style.color}55 100%)`,
                      }}
                    />
                    <span className="relative font-semibold tabular-nums text-ink">
                      {row.war.toFixed(2)}
                    </span>
                  </span>
                </td>
                <td className="py-1 pl-2 text-right tabular-nums text-ink-muted">{row.demand}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
        Top {RAIL_MAX_RANK} at each position. The full chart runs to 36.
      </p>

      {yourBestLine && (
        <p className="mt-2 rounded-card border border-brand-purple/30 bg-brand-purple/5 px-2.5 py-1.5 text-xs text-ink-muted">
          {yourBestLine}
        </p>
      )}

      <Link
        href={positionalWarHref}
        className="mt-3 flex min-h-11 items-center gap-1.5 text-xs font-semibold text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Explore Positional WAR
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      </Link>
    </Panel>
  );
}
