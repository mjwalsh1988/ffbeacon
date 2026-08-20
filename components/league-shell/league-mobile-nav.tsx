/**
 * Switching league section on a phone.
 *
 * The five sections live in the site navigation rail, which a league
 * contributes its own level to (league-rail-sections.tsx). But the rail only
 * exists from lg up. Below that the same rows are in the site navigation
 * drawer, and reaching them costs opening a modal from the header, finding the
 * league's section, and pressing a row. Until now that was the only way to move
 * between Overview, Teams, Power Pulse, Trade Finder, and Transactions on a
 * phone, which is a long way round for the thing you do most inside a league.
 *
 * So below lg the shell carries a docking bar naming the section you are on and
 * opening a sheet of the other four. See components/mobile-nav-dock.tsx.
 *
 * Reads the same list as the rail (nav-items.ts), so a section can never appear
 * in one and go missing from the other, and forwards the searched Sleeper handle
 * on every hop the way `leagueTabHref` already does.
 */

import { MobileNavDock } from "@/components/mobile-nav-dock";
import { LEAGUE_NAV_ITEMS, leagueTabHref, type LeagueTabId } from "./nav-items";

export function LeagueMobileNav({
  sleeperLeagueId,
  activeTab,
  searchedUsername,
}: {
  sleeperLeagueId: string;
  activeTab: LeagueTabId;
  searchedUsername: string | null;
}) {
  const current =
    LEAGUE_NAV_ITEMS.find((item) => item.id === activeTab) ?? LEAGUE_NAV_ITEMS[0];

  return (
    <MobileNavDock
      hideAboveClass="lg:hidden"
      className="mt-6"
      menus={[
        {
          key: "sections",
          eyebrow: "Section",
          currentLabel: current.label,
          heading: "League sections",
          summary: "Rankings, rosters, Power Pulse, trades, and moves",
          icon: "trophy",
          activeId: activeTab,
          items: LEAGUE_NAV_ITEMS.map((item) => ({
            id: item.id,
            label: item.label,
            hint: item.hint,
            icon: item.icon,
            href: leagueTabHref(sleeperLeagueId, item.id, searchedUsername),
          })),
        },
      ]}
    />
  );
}
