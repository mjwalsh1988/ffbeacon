/**
 * The player profile's four sections, in one place.
 *
 * Two things read this list: the site navigation rail, which a profile
 * contributes its sections to (player-rail-sections.tsx), and the compact
 * switcher the profile carries below lg where there is no rail
 * (player-tabs.tsx). Keeping the list here is what stops a section appearing in
 * one and going missing from the other, the same way League Pulse keeps its
 * five in components/league-shell/nav-items.ts.
 *
 * Every section is a route: `?tab=` on the profile, server-rendered, so each one
 * fetches only its own data. The global source and format params ride along on
 * every hop so the header selection keeps driving the profile.
 */

import type { NavIconName } from "@/components/app-shell/nav-icons";

export type PlayerTabId = "overview" | "statistics" | "trades" | "beacon-brief";

export type PlayerNavItem = {
  id: PlayerTabId;
  label: string;
  /** One plain line, painted under the label in the navigation drawer and
   *  carried in the accessible name of the rail row. */
  hint: string;
  /** Name of the icon, resolved by components/app-shell/nav-icons.ts. The rail
   *  takes its tree across the server-to-client boundary, where a component
   *  reference cannot travel. */
  icon: NavIconName;
};

export const PLAYER_NAV_ITEMS: PlayerNavItem[] = [
  {
    id: "overview",
    label: "Overview",
    hint: "News, bio, depth chart, and market value",
    icon: "dashboard",
  },
  {
    id: "statistics",
    label: "Statistics",
    hint: "Projections, career totals, and the weekly game log",
    icon: "barChart",
  },
  {
    id: "trades",
    label: "Trades",
    hint: "Every graded trade this player is in",
    icon: "swap",
  },
  {
    id: "beacon-brief",
    label: "Beacon Brief",
    hint: "Coverage that mentions this player",
    icon: "newspaper",
  },
];

/** The href for one section of a profile, carrying source and format through. */
export function playerTabHref(
  slug: string,
  tabId: PlayerTabId,
  source?: string,
  format?: string,
): string {
  const qs = new URLSearchParams();
  // Overview is the default, so it needs no param and gets the clean URL.
  if (tabId !== "overview") qs.set("tab", tabId);
  if (source) qs.set("source", source);
  if (format) qs.set("format", format);
  const s = qs.toString();
  return `/players/${slug}${s ? `?${s}` : ""}`;
}
