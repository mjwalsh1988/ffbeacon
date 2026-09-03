/**
 * The Positional WAR panel. Server component: does the reads and the copy,
 * then hands plain rows to the client surfaces. Never blocks the page; the
 * caller puts it in its own <Suspense> boundary, matching Power Pulse.
 *
 * TWO VARIANTS, ONE READ PATH.
 *
 *   "dashboard" is the dedicated page at /leagues/[id]/positional-war: the
 *   full 36-rank chart, the trade-value scatterplot beside it, and the
 *   searchable, sortable player table under both, all driven by one position
 *   filter (components/league-war/war-dashboard.tsx).
 *
 *   "preview" is Power Pulse: the same chart, 25 ranks deep, with its own
 *   complete data table and a link onward. That page's subject is expected
 *   performance and scarcity is context for it, so the preview does not carry
 *   the scatterplot, the player table or the upgrade what-if.
 *
 * The League Overview carries NEITHER any more. It used to render the chart
 * and a rail summary card, both drawing the league the dedicated page already
 * draws, on the page a reader lands on first, and it paid for a curve
 * computation to do it. See the note in app/leagues/[league_id]/page.tsx.
 *
 * Both variants read the same cached curve, apply the same tier scale, and
 * resolve ownership the same way, so a player cannot be described differently
 * on the two pages.
 *
 * The panel resolves its own viewer roster (via lib/league-viewer.ts
 * matchViewerRoster, the same rule components/team-filter.tsx uses
 * client-side) so a mounting page only has to pass through the username and
 * roster query params it already carries on every League Pulse link.
 */

import Link from "next/link";
import { currentProjectionSourceCached } from "@/lib/projections/current-source";
import { projectionSourceDisplay } from "@/lib/projections/source-constants";
import { ArrowRight } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { Panel } from "@/components/dashboard-panel";
import { ChartFigure, ChartEmpty, DataTable, Th, Td } from "@/components/chart-kit";
import {
  buildChartGeometry,
  WAR_CHART_MAX_RANK,
  WAR_PREVIEW_MAX_RANK,
  type WarAxisMode,
} from "@/lib/positional-war/chart-geometry";
import { unprojectableSlots } from "@/lib/positional-war/engine";
import { buildTierScale } from "@/lib/positional-war/tiers";
import { WAR_TIER_LABEL } from "@/lib/positional-war/tiers";
import { buildWarDashboardPositions, ownerLabel } from "@/lib/positional-war/table";
import { NON_STARTING_SLOTS, PULSE_SLOT_ELIGIBILITY } from "@/lib/power-pulse/types";
import { describeLeagueScoring, type ScoringSettings } from "@/lib/league-scoring";
import { matchViewerRoster } from "@/lib/league-viewer";
import {
  loadCurveTradeValues,
  loadLeagueOwnership,
  loadPositionalWarStatus,
  loadPositionalWarView,
  loadViewerCandidates,
  loadViewerOverlay,
  resolveUnmatchedOwnerInfo,
} from "@/lib/league-positional-war-data";
import { matchCurveOwnership, splitUnmatchedOwners } from "./overlay";
import {
  buildChartSummary,
  buildEmptyStateMessage,
  buildEmptyStateQuietNote,
  buildFootnote,
  buildNoProjectionLine,
  buildOverlayPositionLine,
  buildPastDepthLine,
  buildTruncationNote,
} from "./summary";
import { PositionalWarChart } from "./positional-war-chart";
import { WarDashboard } from "./war-dashboard";
import { WarAxisToggle } from "./war-axis-toggle";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * Placeholder dimensions for the truncation check below. Truncation is a
 * property of the (curves, mode, maxRank) triple alone (see chart-geometry.ts),
 * so any box gives the answer the client chart's own geometry will.
 */
const GEOMETRY_DIMS = { width: 640, height: 360, padding: { t: 16, r: 16, b: 34, l: 42 } };

export async function PositionalWarPanel({
  supabase,
  leagueRowId,
  leagueName,
  season,
  teamCount,
  rosterPositions,
  scoringSettings,
  searchedUsername,
  focusedRosterId,
  axisMode,
  variant,
  exploreHref,
  formatConfigId = null,
  sourceSlug = null,
  sourceDisplay = "your value source",
  formatDisplay = "this league's format",
}: {
  supabase: AnySupabase;
  leagueRowId: string;
  /** For the CSV filename on the dashboard. */
  leagueName: string;
  season: number;
  /** total_rosters, for "in this N-team league" copy. */
  teamCount: number;
  /** The league's raw Sleeper roster_positions tokens, for the footnote's excluded-positions clause. */
  rosterPositions: string[];
  scoringSettings: ScoringSettings;
  searchedUsername: string | null;
  focusedRosterId: number | null;
  axisMode: WarAxisMode;
  variant: "dashboard" | "preview";
  /** Preview only: where "Explore Positional WAR" goes. */
  exploreHref?: string;
  /** Dashboard only: the league's resolved format and value source, for the scatterplot. */
  formatConfigId?: string | null;
  sourceSlug?: string | null;
  sourceDisplay?: string;
  formatDisplay?: string;
}) {
  const isDashboard = variant === "dashboard";
  const maxRank = isDashboard ? WAR_CHART_MAX_RANK : WAR_PREVIEW_MAX_RANK;

  // loadPositionalWarView and loadViewerCandidates read different tables and
  // neither depends on the other's result, so they run together. Both stay
  // cache()-wrapped so a page that mounts this panel more than once, or
  // alongside another consumer of the same curve, issues one query rather
  // than two racing to read the same rows.
  const [view, candidates] = await Promise.all([
    loadPositionalWarView(supabase, leagueRowId, season),
    loadViewerCandidates(supabase, leagueRowId),
  ]);

  // `every` rather than `length === 0`, and an empty array satisfies it, so
  // this is the old check plus one case it missed: rows that exist but hold no
  // plotted players. One state, one answer: there is nothing to plot, so say
  // so and stop.
  if (!view || view.curves.every((c) => c.curve.length === 0)) {
    const { status } = await loadPositionalWarStatus(supabase, leagueRowId);
    const message = buildEmptyStateMessage(status);
    const quietNote = buildEmptyStateQuietNote(status);
    return (
      <Panel id="positional-war" title="Positional WAR" headingFocusable eyebrow="Waiting on data">
        <ChartEmpty>
          {message}
          {quietNote && <span className="mt-1 block text-xs text-ink-subtle">{quietNote}</span>}
        </ChartEmpty>
      </Panel>
    );
  }

  const viewerRosterId = matchViewerRoster(candidates, searchedUsername, focusedRosterId);

  // Every player the surfaces will actually render, so the value read below
  // asks about exactly those and no more. Six positions capped at 36 is at
  // most 216 ids, comfortably one query.
  const renderedPlayerIds = view.curves.flatMap((curve) =>
    curve.curve.filter((p) => p.positionRank <= maxRank).map((p) => p.playerId),
  );

  // Ownership for the whole league (two small queries), the viewer's own
  // roster for the overlay lines, and, on the dashboard only, current trade
  // values. None of the three depends on another.
  const [owners, overlay, values] = await Promise.all([
    loadLeagueOwnership(supabase, leagueRowId),
    viewerRosterId !== null ? loadViewerOverlay(supabase, leagueRowId, viewerRosterId) : null,
    isDashboard
      ? loadCurveTradeValues(supabase, renderedPlayerIds, formatConfigId, sourceSlug)
      : new Map<string, number>(),
  ]);
  const ownedSleeperIds = overlay?.ownedSleeperIds ?? new Set<string>();

  const tierScale = buildTierScale(view.curves);
  const dashboardPositions = buildWarDashboardPositions({
    curves: view.curves,
    maxRank,
    scale: tierScale,
    owners,
    values,
    viewerRosterId,
  });

  // MATCHED AGAINST THE CAPPED CURVES, not the stored ones. Every sentence
  // built from this ownership match sits next to a chart that stops at
  // `maxRank`, so matching deeper would name a player the reader cannot see and
  // cannot find in the table either. An owned player ranked past the cap now
  // falls out as unmatched, which is exactly the case splitUnmatchedOwners
  // reports as "yours, past the chart's depth", by name.
  const ownership = matchCurveOwnership(dashboardPositions, ownedSleeperIds);
  const unmatchedInfo =
    ownership.unmatchedOwnedIds.length > 0
      ? await resolveUnmatchedOwnerInfo(supabase, ownership.unmatchedOwnedIds)
      : new Map();
  const unmatchedSplit = splitUnmatchedOwners(ownership.unmatchedOwnedIds, unmatchedInfo);

  // Same reasoning: the summary introduces the chart, so it describes the
  // players the chart plots.
  // WHOSE PROJECTIONS THE CURVE IS BUILT FROM, asked about the curve's OWN
  // window rather than the season.
  //
  // NOT THE SAME THING as `sourceDisplay` above, which is the VALUE source the
  // reader picked (KTC, FantasyCalc). Positional WAR deliberately does not vary
  // by that one at all; it varies by this one, which an admin switches.
  //
  // The window matters. Our builder only writes weeks from the live one
  // forward, so a season that is covered from week 6 on and has a gap in week 2
  // reads as covered to this curve and uncovered to a whole-season question. It
  // is the same engine the fingerprint recorded (lib/positional-war/
  // fingerprint.ts resolves it over these same bounds), so the label and the
  // numbers describe one thing. Free while the feature is off.
  const projectionSourceLabel = projectionSourceDisplay(
    await currentProjectionSourceCached(
      view.fromWeek !== null && view.throughWeek !== null
        ? { season, fromWeek: view.fromWeek, toWeek: view.throughWeek }
        : undefined,
    ),
  );

  const summary = buildChartSummary(dashboardPositions, teamCount);
  const excludedSlots = unprojectableSlots(rosterPositions, NON_STARTING_SLOTS, PULSE_SLOT_ELIGIBILITY);
  const scoringDescription = describeLeagueScoring(scoringSettings);
  const footnote = buildFootnote({
    fromWeek: view.fromWeek,
    throughWeek: view.throughWeek,
    scoringDescription,
    teamCount,
    excludedSlots,
    shallowPositions: view.shallowPositions,
    modelVersion: view.modelVersion,
    generatedAt: view.generatedAt,
    isStale: view.isStale,
    projectionSourceLabel,
  });

  const noteGeometry = buildChartGeometry({
    curves: view.curves.filter((c) => c.curve.length > 0),
    mode: axisMode,
    maxRank,
    ...GEOMETRY_DIMS,
  });
  const truncationNote = buildTruncationNote(
    maxRank,
    noteGeometry.series.some((s) => s.truncated),
  );

  const overlayLines =
    ownedSleeperIds.size > 0
      ? dashboardPositions
          .filter((c) => c.curve.length > 0)
          .map((curve) => {
            const best = ownership.matchedByPosition.get(curve.position)?.[0] ?? null;
            return buildOverlayPositionLine(curve, best?.positionRank ?? null, best?.war ?? null);
          })
      : [];
  const pastDepthLine = buildPastDepthLine(unmatchedSplit.pastDepth.map((p) => p.name));
  const noProjectionLine = buildNoProjectionLine(unmatchedSplit.noProjectionCount);

  if (isDashboard) {
    return (
      <Panel
        id="positional-war"
        title="Positional WAR"
        eyebrow="Scarcity"
        headingFocusable
        helper="Which positions are hard to replace in this league, and who the players are."
        action={<WarAxisToggle mode={axisMode} />}
      >
        <WarDashboard
          positions={dashboardPositions}
          axisMode={axisMode}
          maxRank={maxRank}
          tierScale={tierScale}
          chartSummary={summary}
          leagueName={leagueName}
          sourceDisplay={sourceDisplay}
          formatDisplay={formatDisplay}
        />

        {truncationNote && <p className="mt-3 text-xs text-ink-subtle">{truncationNote}</p>}

        {(overlayLines.length > 0 || pastDepthLine || noProjectionLine) && (
          <ul className="mt-3 space-y-1 text-xs text-ink-muted">
            {overlayLines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
            {pastDepthLine && <li>{pastDepthLine}</li>}
            {noProjectionLine && <li>{noProjectionLine}</li>}
          </ul>
        )}

        <p className="mt-3 text-xs text-ink-subtle">{footnote}</p>
      </Panel>
    );
  }

  const previewRows = dashboardPositions.flatMap((position) =>
    position.curve.map((row) => ({ position: position.position, row })),
  );

  return (
    <Panel
      id="positional-war"
      title="Positional WAR"
      eyebrow="Scarcity"
      headingFocusable
      helper={`How steeply each position drops off in this league. Top ${maxRank} at each.`}
    >
      <ChartFigure
        // The Panel above renders an h2, so the figure title is an h3. Passing
        // nothing would leave the default h4 and skip a level.
        titleLevel={3}
        title="Wins over replacement"
        summary={summary}
        tableLabel="View every plotted player"
        table={
          <DataTable
            caption={`The top ${maxRank} at each position, by wins over replacement`}
            head={
              <>
                <Th>Pos</Th>
                <Th>Rank</Th>
                <Th>Player</Th>
                <Th>Team</Th>
                <Th>Manager</Th>
                <Th>Tier</Th>
                <Th numeric>Wins over replacement</Th>
                <Th numeric>Pts over replacement</Th>
                <Th numeric>Proj pts/wk</Th>
                <Th numeric>Replacement pts/wk</Th>
                <Th numeric>Weeks projected</Th>
                <Th>Status</Th>
              </>
            }
          >
            {previewRows.map(({ position, row }) => (
              <tr key={row.playerId}>
                <Td>{position}</Td>
                <Td numeric>{row.positionRank}</Td>
                <Td>
                  {row.name}
                  {row.isYours ? " (yours)" : ""}
                </Td>
                <Td>{row.team ?? "no team"}</Td>
                <Td>{ownerLabel(row.owner)}</Td>
                <Td>{WAR_TIER_LABEL[row.tier]}</Td>
                <Td numeric>{row.war.toFixed(2)}</Td>
                <Td numeric>{row.pointsAboveReplacement.toFixed(1)}</Td>
                <Td numeric>{row.projectedPointsPerWeek.toFixed(1)}</Td>
                <Td numeric>{row.replacementPointsPerWeek.toFixed(1)}</Td>
                <Td numeric>{row.weeksProjected}</Td>
                {/* Sleeper's designation verbatim, blank when healthy. The
                    overlay marks an injured player rather than hiding him, so
                    the table has to say why he is where he is. */}
                <Td>{row.injuryStatus ?? ""}</Td>
              </tr>
            ))}
          </DataTable>
        }
      >
        <PositionalWarChart curves={dashboardPositions} axisMode={axisMode} maxRank={maxRank} />
      </ChartFigure>

      {truncationNote && <p className="mt-2 text-xs text-ink-subtle">{truncationNote}</p>}

      {(overlayLines.length > 0 || pastDepthLine || noProjectionLine) && (
        <ul className="mt-3 space-y-1 text-xs text-ink-muted">
          {overlayLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
          {pastDepthLine && <li>{pastDepthLine}</li>}
          {noProjectionLine && <li>{noProjectionLine}</li>}
        </ul>
      )}

      {exploreHref && (
        <Link
          href={exploreHref}
          className="mt-4 flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Explore Positional WAR
          <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
        </Link>
      )}

      <p className="mt-3 text-xs text-ink-subtle">{footnote}</p>
    </Panel>
  );
}
