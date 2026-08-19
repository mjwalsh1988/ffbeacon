/**
 * The League Pulse section list, in one place. Both the desktop rail
 * (league-side-nav.tsx) and the mobile sheet (league-mobile-nav.tsx) read from
 * here, so a section can never appear in one and go missing from the other.
 *
 * Overview and Teams are inline views on `/leagues/[id]`; Power Pulse, Trade
 * Finder, and Transactions are full routes of their own. `leagueTabHref`
 * knows which is which and forwards the searched Sleeper handle either way, so
 * the in-view switcher and the Teams-tab owner default survive every hop.
 */

import type { NavIconName } from "@/components/app-shell/nav-icons";

export type LeagueTabId =
  | "overview"
  | "teams"
  | "power-pulse"
  | "trade-finder"
  | "transactions";

export type LeagueNavItem = {
  id: LeagueTabId;
  label: string;
  /** One line of plain description. Painted under the label in the navigation
   *  drawer, and carried in the accessible name of the rail link at both
   *  sizes. */
  hint: string;
  /** Name of the icon, resolved by components/app-shell/nav-icons.ts. The rail
   *  takes its tree across the server-to-client boundary, where a component
   *  reference cannot travel. */
  icon: NavIconName;
};

export const LEAGUE_NAV_ITEMS: LeagueNavItem[] = [
  {
    id: "overview",
    label: "Overview",
    hint: "Rankings and league snapshot",
    icon: "dashboard",
  },
  {
    id: "teams",
    label: "Teams",
    hint: "Every roster side by side",
    icon: "users",
  },
  {
    id: "power-pulse",
    label: "Power Pulse",
    hint: "What each roster should win from here",
    icon: "activity",
  },
  {
    id: "trade-finder",
    label: "Trade Finder",
    hint: "One trade worth offering, at a time",
    icon: "handshake",
  },
  {
    id: "transactions",
    label: "Transactions",
    hint: "Trades, waivers, and FAAB moves",
    icon: "swap",
  },
];

/** The href for one section of a league, with the searched handle forwarded. */
export function leagueTabHref(
  sleeperLeagueId: string,
  tabId: LeagueTabId,
  searchedUsername: string | null,
): string {
  const qs = new URLSearchParams();
  if (searchedUsername) qs.set("username", searchedUsername);

  if (tabId === "transactions" || tabId === "power-pulse" || tabId === "trade-finder") {
    const s = qs.toString();
    return `/leagues/${sleeperLeagueId}/${tabId}${s ? `?${s}` : ""}`;
  }

  qs.set("tab", tabId);
  return `/leagues/${sleeperLeagueId}?${qs.toString()}`;
}
