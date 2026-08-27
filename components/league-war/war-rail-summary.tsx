/**
 * The rail summary card (E6, T-WAR-27): three lines of text with real
 * numbers, living in the Overview's right rail above "Explore this league".
 * A finding, not a navigation entry, so it earns a place ahead of the
 * link list per section 15.6's placement rule.
 *
 * Reads through the same React cache()-wrapped loadPositionalWarView the
 * chart panel uses, so on a render where both mount, the two issue one
 * combined query rather than each fetching the league's curves separately
 * (acceptance criterion E6-1).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { Panel } from "@/components/dashboard-panel";
import { matchViewerRoster } from "@/lib/league-viewer";
import {
  loadPositionalWarView,
  loadViewerCandidates,
  loadViewerOverlay,
  resolveUnmatchedOwnerInfo,
} from "@/lib/league-positional-war-data";
import { matchCurveOwnership, splitUnmatchedOwners } from "./overlay";
import { buildYourBestLine, selectScarcestAndDeepest } from "./selection";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

function findingLine(
  label: string,
  curve: { position: string; warRank1: number | null; structuralDemand: number },
) {
  if (curve.warRank1 === null) return null;
  return (
    <li className="flex items-baseline gap-2">
      <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </span>
      <span className="text-xs text-ink-muted">
        <span className="font-semibold text-ink">
          {curve.position}1
        </span>{" "}
        is worth {curve.warRank1.toFixed(2)} wins. {curve.structuralDemand} start.
      </span>
    </li>
  );
}

export async function WarRailSummary({
  supabase,
  leagueRowId,
  season,
  searchedUsername,
  focusedRosterId,
}: {
  supabase: AnySupabase;
  leagueRowId: string;
  season: number;
  searchedUsername: string | null;
  focusedRosterId: number | null;
}) {
  // loadPositionalWarView and loadViewerCandidates read different tables and
  // neither depends on the other's result, so they run together. Both are
  // cache()-wrapped, so on the render where PositionalWarPanel also mounts,
  // this pair is shared rather than doubled.
  const [view, candidates] = await Promise.all([
    loadPositionalWarView(supabase, leagueRowId, season),
    loadViewerCandidates(supabase, leagueRowId),
  ]);
  // No cached curve, or a status where the honest diagnosis belongs in the
  // panel below rather than in the rail: no card at all. An empty finding
  // card is worse than no card.
  // Matches the panel: rows that exist but hold no plotted players are the
  // same "nothing to show" state as no rows at all, and an empty array
  // satisfies `every`.
  if (!view || view.curves.every((c) => c.curve.length === 0)) return null;
  if (view.status === "settled" || view.status === "error") return null;

  const { scarcest, deepest } = selectScarcestAndDeepest(view.curves);
  if (!scarcest) return null;

  let yourBestLine: string | null = null;
  const rosterId = matchViewerRoster(candidates, searchedUsername, focusedRosterId);
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

  return (
    // The heading names the card, not the metric. The full chart panel further
    // down the same page is also headed "Positional WAR", and two identical
    // headings give a reader scanning the heading list no way to tell them
    // apart: the differentiating "Finding" is an eyebrow, not part of the
    // accessible name.
    <Panel
      eyebrow="Finding"
      title="Positional WAR at a glance"
      bodyClassName="px-4 py-3.5 sm:px-5"
    >
      <ul className="space-y-2">
        {findingLine("Scarcest", scarcest)}
        {deepest && findingLine("Deepest", deepest)}
        {yourBestLine && (
          <li className="flex items-baseline gap-2">
            <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
              Your best
            </span>
            <span className="text-xs text-ink-muted">{yourBestLine}</span>
          </li>
        )}
      </ul>
      {/*
        A bare fragment link: the chart panel this anchors to lives on the
        SAME /leagues/[id] overview page (section 15.6's placement rule), so
        this never navigates, only scrolls and (because the target heading
        carries tabIndex={-1} via Panel's headingFocusable prop) moves focus
        to it, per E6-2.
      */}
      <a
        href="#positional-war-title"
        className="mt-3 flex min-h-11 items-center gap-1 text-xs font-semibold text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        See the full curve
        <span aria-hidden="true" className="pointer-events-none">
          &#8594;
        </span>
      </a>
    </Panel>
  );
}
