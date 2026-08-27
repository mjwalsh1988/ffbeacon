/**
 * Positional WAR panel (T-WAR-20b). Server component: does the read and the
 * copy, wraps the chart in ChartFigure. Never blocks the page; the caller
 * puts it in its own <Suspense> boundary, matching Power Pulse.
 *
 * The panel resolves its own viewer roster (via lib/league-viewer.ts
 * matchViewerRoster, the same rule components/team-filter.tsx uses
 * client-side) so a mounting page only has to pass through the username and
 * roster query params it already carries on every League Pulse link.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { Panel } from "@/components/dashboard-panel";
import { ChartFigure, ChartEmpty, DataTable, Th, Td } from "@/components/chart-kit";
import { buildChartGeometry, parseAxisMode, type WarAxisMode } from "@/lib/positional-war/chart-geometry";
import { unprojectableSlots } from "@/lib/positional-war/engine";
import { NON_STARTING_SLOTS, PULSE_SLOT_ELIGIBILITY } from "@/lib/power-pulse/types";
import { describeLeagueScoring, type ScoringSettings } from "@/lib/league-scoring";
import { matchViewerRoster } from "@/lib/league-viewer";
import {
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
} from "./summary";
import { PositionalWarChart } from "./positional-war-chart";
import { WarAxisToggle } from "./war-axis-toggle";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

const GEOMETRY_DIMS = { width: 640, height: 360, padding: { t: 16, r: 16, b: 34, l: 42 } };

export async function PositionalWarPanel({
  supabase,
  leagueRowId,
  season,
  teamCount,
  rosterPositions,
  scoringSettings,
  searchedUsername,
  focusedRosterId,
  war,
}: {
  supabase: AnySupabase;
  leagueRowId: string;
  season: number;
  /** total_rosters, for "in this N-team league" copy. */
  teamCount: number;
  /** The league's raw Sleeper roster_positions tokens, for the footnote's excluded-positions clause. */
  rosterPositions: string[];
  scoringSettings: ScoringSettings;
  searchedUsername: string | null;
  focusedRosterId: number | null;
  /** The raw `?war=` searchParam value. */
  war?: string | string[] | null;
}) {
  const axisMode: WarAxisMode = parseAxisMode(war);
  // loadPositionalWarView and loadViewerCandidates read different tables and
  // neither depends on the other's result, so they run together. Both are
  // cache()-wrapped, so on the render where WarRailSummary also mounts, this
  // pair is shared rather than doubled, and on the (rare) empty-curves path
  // below, the now-unused candidates read is cheap and already deduped.
  const [view, candidates] = await Promise.all([
    loadPositionalWarView(supabase, leagueRowId, season),
    loadViewerCandidates(supabase, leagueRowId),
  ]);

  // `every` rather than `length === 0`, and an empty array satisfies it, so
  // this is the old check plus one case it missed: rows that exist but hold no
  // plotted players. The chart component returns null for that state and the
  // data table would render its header over nothing, so the panel used to draw
  // an empty figure frame beside a "not calculated yet" sentence. One state,
  // one answer: there is nothing to plot, so say so and stop.
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

  const rosterId = matchViewerRoster(candidates, searchedUsername, focusedRosterId);
  const overlay = rosterId !== null ? await loadViewerOverlay(supabase, leagueRowId, rosterId) : null;
  const ownedSleeperIds = overlay?.ownedSleeperIds ?? new Set<string>();

  const ownership = matchCurveOwnership(view.curves, ownedSleeperIds);
  const unmatchedInfo =
    ownership.unmatchedOwnedIds.length > 0
      ? await resolveUnmatchedOwnerInfo(supabase, ownership.unmatchedOwnedIds)
      : new Map();
  const unmatchedSplit = splitUnmatchedOwners(ownership.unmatchedOwnedIds, unmatchedInfo);

  const matchedIds = new Set<string>();
  for (const points of ownership.matchedByPosition.values()) {
    for (const p of points) matchedIds.add(p.playerId);
  }

  const summary = buildChartSummary(view.curves, teamCount);
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
  });

  // Truncation is a property of the (curves, axis mode) pair alone; the pixel
  // dimensions below never affect it (see chart-geometry.ts's rankCap
  // derivation), so computing it here with placeholder dimensions gives the
  // same answer the client chart's own geometry will.
  const noteGeometry = buildChartGeometry({
    curves: view.curves.filter((c) => c.curve.length > 0),
    mode: axisMode,
    ...GEOMETRY_DIMS,
  });
  const axisTruncated = axisMode === "rank" && noteGeometry.series.some((s) => s.truncated);

  const overlayLines =
    ownedSleeperIds.size > 0
      ? view.curves
          .filter((c) => c.curve.length > 0)
          .map((curve) => {
            const best = ownership.matchedByPosition.get(curve.position)?.[0] ?? null;
            return buildOverlayPositionLine(curve, best?.positionRank ?? null, best?.war ?? null);
          })
      : [];
  const pastDepthLine = buildPastDepthLine(unmatchedSplit.pastDepth.map((p) => p.name));
  const noProjectionLine = buildNoProjectionLine(unmatchedSplit.noProjectionCount);

  const rows = view.curves.flatMap((curve) =>
    curve.curve.map((point) => ({ curve, point, isYours: matchedIds.has(point.playerId) })),
  );

  return (
    <Panel
      id="positional-war"
      title="Positional WAR"
      eyebrow="Scarcity"
      headingFocusable
      helper="How steeply each position drops off in this league."
      action={<WarAxisToggle mode={axisMode} />}
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
            caption="Every plotted player, by position and rank"
            head={
              <>
                <Th>Pos</Th>
                <Th>Rank</Th>
                <Th>Player</Th>
                <Th>Team</Th>
                <Th numeric>Positional WAR</Th>
                <Th numeric>Pts above replacement</Th>
                <Th numeric>Proj pts/wk</Th>
                <Th numeric>Replacement pts/wk</Th>
                <Th numeric>Weeks projected</Th>
                <Th>Status</Th>
                {ownedSleeperIds.size > 0 && <Th>Yours</Th>}
              </>
            }
          >
            {rows.map(({ curve, point, isYours }) => (
              <tr key={point.playerId}>
                <Td>{curve.position}</Td>
                <Td numeric>{point.positionRank}</Td>
                <Td>{point.name}</Td>
                <Td>{point.team ?? "FA"}</Td>
                <Td numeric>{point.war.toFixed(2)}</Td>
                <Td numeric>{point.pointsAboveReplacement.toFixed(1)}</Td>
                <Td numeric>{point.projectedPointsPerWeek.toFixed(1)}</Td>
                <Td numeric>{point.replacementPointsPerWeek.toFixed(1)}</Td>
                {/* Sleeper's designation verbatim, blank when healthy. The
                    overlay marks an injured player rather than hiding him, so
                    the table has to say why he is where he is. */}
                <Td numeric>{point.weeksProjected}</Td>
                <Td>{point.injuryStatus ?? ""}</Td>
                {ownedSleeperIds.size > 0 && <Td>{isYours ? "Yours" : ""}</Td>}
              </tr>
            ))}
          </DataTable>
        }
      >
        <PositionalWarChart
          curves={view.curves}
          axisMode={axisMode}
          ownedSleeperIds={[...ownedSleeperIds]}
        />
      </ChartFigure>

      {axisTruncated && (
        <p className="mt-2 text-xs text-ink-subtle">
          Plotted to rank 60. Some positions run deeper.
        </p>
      )}

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
