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

import {
  LayoutDashboard,
  Users,
  Activity,
  Handshake,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";

export type LeagueTabId =
  | "overview"
  | "teams"
  | "power-pulse"
  | "trade-finder"
  | "transactions";

export type LeagueNavItem = {
  id: LeagueTabId;
  label: string;
  /** One line of plain description. Shown in the mobile sheet, where there is
   *  room for it, and used as the rail link's title tooltip. */
  hint: string;
  icon: LucideIcon;
  isNew?: boolean;
};

export const LEAGUE_NAV_ITEMS: LeagueNavItem[] = [
  {
    id: "overview",
    label: "Overview",
    hint: "Rankings and league snapshot",
    icon: LayoutDashboard,
  },
  {
    id: "teams",
    label: "Teams",
    hint: "Every roster side by side",
    icon: Users,
  },
  {
    id: "power-pulse",
    label: "Power Pulse",
    hint: "What each roster should win from here",
    icon: Activity,
  },
  {
    id: "trade-finder",
    label: "Trade Finder",
    hint: "One trade worth offering, at a time",
    icon: Handshake,
    isNew: true,
  },
  {
    id: "transactions",
    label: "Transactions",
    hint: "Trades, waivers, and FAAB moves",
    icon: ArrowLeftRight,
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

/** The display label for a section id, for the mobile bar's "you are here". */
export function leagueTabLabel(tabId: LeagueTabId): string {
  return LEAGUE_NAV_ITEMS.find((i) => i.id === tabId)?.label ?? "Overview";
}
