"use client";

/**
 * Puts a league's five sections into the site navigation rail.
 *
 * Once you are inside a league, those five sections are the navigation you
 * actually want, so they go to the top of the rail as a "This league" entry
 * that is already opened to its second level. Every site section is still one
 * Back press away, which is what a second, league-only rail could never offer.
 *
 * Renders nothing. The rail reads the registration from context; see
 * components/app-shell/rail-sections.tsx.
 */

import { useMemo } from "react";
import type { Route } from "next";
import type { NavNode } from "@/lib/nav-types";
import { RegisterRailSections } from "@/components/app-shell/rail-sections";
import { LEAGUE_NAV_ITEMS, leagueTabHref, type LeagueTabId } from "./nav-items";

export const LEAGUE_RAIL_SECTION_ID = "league-sections";

export function LeagueRailSections({
  sleeperLeagueId,
  leagueName,
  activeTab,
  searchedUsername,
}: {
  sleeperLeagueId: string;
  leagueName: string;
  activeTab: LeagueTabId;
  searchedUsername: string | null;
}) {
  const sections = useMemo<NavNode[]>(
    () => [
      {
        id: LEAGUE_RAIL_SECTION_ID,
        label: leagueName,
        href: leagueTabHref(sleeperLeagueId, "overview", searchedUsername) as Route,
        hint: "Everything about this league",
        icon: "radio",
        indexLabel: "League overview",
        children: LEAGUE_NAV_ITEMS.map((item) => ({
          id: `league-${item.id}`,
          label: item.label,
          href: leagueTabHref(sleeperLeagueId, item.id, searchedUsername) as Route,
          hint: item.hint,
          icon: item.icon,
        })),
      },
    ],
    [sleeperLeagueId, leagueName, searchedUsername],
  );

  return (
    <RegisterRailSections
      sections={sections}
      openId={LEAGUE_RAIL_SECTION_ID}
      active={{ sectionId: LEAGUE_RAIL_SECTION_ID, childId: `league-${activeTab}` }}
    />
  );
}
