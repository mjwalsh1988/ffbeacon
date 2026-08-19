"use client";

/**
 * Puts a player's four sections into the site navigation rail, the same way
 * League Pulse puts a league's five there.
 *
 * The profile used to carry a horizontal bar of tabs under its masthead. The
 * rail is where navigation lives now, so the sections move into it as a section
 * named for the player, already opened to its second level, and the profile gets
 * the full width of the content column back.
 *
 * The section has no href of its own: Overview is the profile's own page, and it
 * is already the first child, so an index row above it would be the same link
 * twice.
 *
 * Which row is current cannot be read from the pathname here. All four sections
 * are the same path and differ only by `?tab=`, so the profile states it on the
 * registration; see `active` in components/app-shell/rail-sections.tsx.
 *
 * Renders nothing.
 */

import { useMemo } from "react";
import type { Route } from "next";
import type { NavNode } from "@/lib/nav-types";
import { RegisterRailSections } from "@/components/app-shell/rail-sections";
import { PLAYER_NAV_ITEMS, playerTabHref, type PlayerTabId } from "./nav-items";

export const PLAYER_RAIL_SECTION_ID = "player-sections";

export function PlayerRailSections({
  slug,
  playerName,
  activeTab,
  source,
  format,
}: {
  slug: string;
  /** Names the section, so the rail says whose profile you are on. */
  playerName: string;
  activeTab: PlayerTabId;
  source?: string;
  format?: string;
}) {
  const sections = useMemo<NavNode[]>(
    () => [
      {
        id: PLAYER_RAIL_SECTION_ID,
        label: playerName.trim() || "Player",
        hint: "Everything on this player",
        icon: "userCircle",
        children: PLAYER_NAV_ITEMS.map((item) => ({
          id: `player-tab-${item.id}`,
          label: item.label,
          href: playerTabHref(slug, item.id, source, format) as Route,
          hint: item.hint,
          icon: item.icon,
        })),
      },
    ],
    [slug, playerName, source, format],
  );

  return (
    <RegisterRailSections
      sections={sections}
      openId={PLAYER_RAIL_SECTION_ID}
      active={{
        sectionId: PLAYER_RAIL_SECTION_ID,
        childId: `player-tab-${activeTab}`,
      }}
    />
  );
}
