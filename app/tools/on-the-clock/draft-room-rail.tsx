"use client";

/**
 * Puts the draft room's eight views into the site navigation rail, the same way
 * League Pulse puts a league's five sections there.
 *
 * The one difference is what a row does. League Pulse sections are routes, so
 * those rows are links. Draft views are eight states of one live page: the room
 * holds a websocket, a synced board, a loaded player pool, and whatever the
 * reader has half-built in the trade builder. Navigating to change view would
 * throw all of that away and re-fetch it, so these rows switch the view in
 * place. See `onSelect` in lib/nav-types.ts.
 *
 * Renders nothing. The rail reads the registration from context; see
 * components/app-shell/rail-sections.tsx.
 */

import { useMemo } from "react";
import type { NavNode } from "@/lib/nav-types";
import type { NavIconName } from "@/components/app-shell/nav-icons";
import { RegisterRailSections } from "@/components/app-shell/rail-sections";

export const DRAFT_RAIL_SECTION_ID = "draft-room-views";

/** One draft view, as the rail needs to know it. */
export type DraftRailView<Id extends string> = {
  id: Id;
  label: string;
  /** One plain line, painted under the label in the navigation drawer and
   *  carried in the accessible name of the rail row. */
  hint: string;
  icon: NavIconName;
};

export function DraftRoomRail<Id extends string>({
  views,
  activeView,
  onSelect,
  leagueName,
}: {
  views: ReadonlyArray<DraftRailView<Id>>;
  activeView: Id;
  onSelect: (id: Id) => void;
  /** Names the section, so the rail says which draft you are in. */
  leagueName: string | null;
}) {
  const sections = useMemo<NavNode[]>(
    () => [
      {
        id: DRAFT_RAIL_SECTION_ID,
        label: leagueName?.trim() || "Draft room",
        // No href: the room has no page of its own to link back to, so the
        // second level opens straight onto the views with no index row.
        hint: "Every view of this draft",
        icon: "timer",
        children: views.map((view) => ({
          id: `draft-view-${view.id}`,
          label: view.label,
          hint: view.hint,
          icon: view.icon,
          onSelect: () => onSelect(view.id),
        })),
      },
    ],
    [views, onSelect, leagueName],
  );

  return (
    <RegisterRailSections
      sections={sections}
      openId={DRAFT_RAIL_SECTION_ID}
      active={{
        sectionId: DRAFT_RAIL_SECTION_ID,
        childId: `draft-view-${activeView}`,
      }}
    />
  );
}
