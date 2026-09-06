"use client";

/**
 * Puts a league's five sections into the site navigation rail, plus the one
 * action that belongs beside them.
 *
 * Once you are inside a league, those five sections are the navigation you
 * actually want, so they go to the top of the rail as a "This league" entry
 * that is already opened to its second level. Every site section is still one
 * Back press away, which is what a second, league-only rail could never offer.
 *
 * REFRESH IS A ROW HERE, not a button in the header. It is an occasional
 * maintenance action rather than something you reach for while reading a
 * league, and in the header it was the control that pushed the action row onto
 * a second line on a phone. It switches something in place rather than
 * navigating, which is what `onSelect` is for; see lib/nav-types.ts.
 *
 * Refresh is deliberately open to everyone, guests included, and the server
 * protects it with a shared per-league cooldown rather than an auth check (see
 * lib/use-league-refresh.ts and the CI guard in
 * lib/security/league-refresh-public.test.ts). Nothing here gates it.
 *
 * Renders a live region and nothing else. The rail reads the registration from
 * context; see components/app-shell/rail-sections.tsx.
 */

import { useMemo } from "react";
import type { Route } from "next";
import type { NavNode } from "@/lib/nav-types";
import { RegisterRailSections } from "@/components/app-shell/rail-sections";
import { useLeagueRefresh } from "@/lib/use-league-refresh";
import type { SleeperViewer } from "@/lib/sleeper-handle/types";
import { LEAGUE_NAV_ITEMS, leagueTabHref, type LeagueTabId } from "./nav-items";

export const LEAGUE_RAIL_SECTION_ID = "league-sections";

export function LeagueRailSections({
  sleeperLeagueId,
  leagueName,
  activeTab,
  viewer,
}: {
  sleeperLeagueId: string;
  leagueName: string;
  activeTab: LeagueTabId;
  /** Who this page is acting for. leagueTabHref carries the handle into the
   *  row hrefs only when the reader arrived on a ?username= link. */
  viewer: SleeperViewer | null;
}) {
  const { refresh, pending, status, announcement } = useLeagueRefresh(sleeperLeagueId);

  // The row says what happened to the last attempt, because a rail row has
  // nowhere to put an error message of its own. The live region below carries
  // the same thing for a screen reader.
  const refreshHint = pending
    ? "Pulling the latest from Sleeper"
    : status.kind === "error"
      ? status.message
      : status.kind === "success"
        ? "Up to date"
        : "Pull the latest rosters, trades, and waivers";

  const sections = useMemo<NavNode[]>(
    () => [
      {
        id: LEAGUE_RAIL_SECTION_ID,
        label: leagueName,
        // No href, and so no index row above the children. Overview is already
        // the first child; carrying an href here rendered a "League overview"
        // row directly above an "Overview" row, both pointing at the same page.
        hint: "Everything about this league",
        icon: "radio",
        children: [
          ...LEAGUE_NAV_ITEMS.map((item) => ({
            id: `league-${item.id}`,
            label: item.label,
            href: leagueTabHref(sleeperLeagueId, item.id, viewer) as Route,
            hint: item.hint,
            icon: item.icon,
          })),
          {
            id: "league-refresh",
            label: pending ? "Refreshing" : "Refresh from Sleeper",
            hint: refreshHint,
            icon: "refresh" as const,
            onSelect: refresh,
          },
        ],
      },
    ],
    [sleeperLeagueId, leagueName, viewer, pending, refreshHint, refresh],
  );

  return (
    <>
      <RegisterRailSections
        sections={sections}
        openId={LEAGUE_RAIL_SECTION_ID}
        active={{ sectionId: LEAGUE_RAIL_SECTION_ID, childId: `league-${activeTab}` }}
      />
      <p className="sr-only" aria-live="polite" role="status">
        {announcement}
      </p>
    </>
  );
}
