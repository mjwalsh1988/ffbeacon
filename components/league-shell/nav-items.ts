/**
 * The League Pulse section list, in one place. Both the desktop rail
 * (league-side-nav.tsx) and the mobile sheet (league-mobile-nav.tsx) read from
 * here, so a section can never appear in one and go missing from the other.
 *
 * Overview and Teams are inline views on `/leagues/[id]`; Schedules, Power Pulse,
 * Positional WAR, Decisions, Trade Ideas, and Transactions are full routes of
 * their own.
 * `leagueTabHref` knows which is which and forwards the searched Sleeper handle
 * either way, so the in-view switcher and the Teams-tab owner default survive
 * every hop.
 */

import type { NavIconName } from "@/components/app-shell/nav-icons";

export type LeagueTabId =
  | "overview"
  | "activity"
  | "teams"
  | "schedules"
  | "power-pulse"
  | "positional-war"
  | "decisions"
  | "trade-ideas"
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
    id: "activity",
    label: "Activity",
    hint: "Everything that has happened in this league",
    icon: "history",
  },
  {
    id: "teams",
    label: "Teams",
    hint: "Every roster side by side",
    icon: "users",
  },
  {
    id: "schedules",
    label: "Schedules",
    hint: "Every week, every matchup, both lineups",
    icon: "calendar",
  },
  {
    id: "power-pulse",
    label: "Power Pulse",
    hint: "What each roster should win from here",
    icon: "activity",
  },
  {
    id: "positional-war",
    label: "Positional WAR",
    hint: "Which positions are scarce in this league",
    icon: "trendingDown",
  },
  {
    id: "decisions",
    label: "Decisions",
    hint: "How well each manager has played the roster they have",
    icon: "listChecks",
  },
  {
    id: "trade-ideas",
    label: "Trade Ideas",
    hint: "Deals worth offering, and any deal you want checked",
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

  if (
    tabId === "activity" ||
    tabId === "transactions" ||
    tabId === "power-pulse" ||
    tabId === "positional-war" ||
    tabId === "decisions" ||
    tabId === "trade-ideas" ||
    tabId === "schedules"
  ) {
    const s = qs.toString();
    return `/leagues/${sleeperLeagueId}/${tabId}${s ? `?${s}` : ""}`;
  }

  qs.set("tab", tabId);
  return `/leagues/${sleeperLeagueId}?${qs.toString()}`;
}
