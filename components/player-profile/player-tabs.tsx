/**
 * Switching profile section on a phone.
 *
 * The four sections live in the site navigation rail, which is where navigation
 * belongs and which is the whole point of the rail. But the rail only exists
 * from lg up. Below that the same rows are in the site navigation drawer, and
 * reaching them costs opening a modal from the header, finding the section, and
 * pressing a row. So below lg the profile carries a docking bar instead, in the
 * place the old full-width tab strip used to sit.
 *
 * That strip is gone. It was a row of four chips that wrapped onto two lines on
 * a narrow phone, it took a block of vertical space above the fold on every
 * profile, and it looked like nothing else on the site. The bar names the
 * section you are on, opens a sheet of the other three, and follows you down
 * the page. See components/mobile-nav-dock.tsx.
 *
 * The rail rows remain the canonical switcher, and this reads the same list
 * (nav-items.ts), so the two can never disagree. Nothing here is exclusive to
 * the small layout: every row exists in the rail and in the drawer.
 *
 * These are navigation LINKS, not a client tablist: each section is its own
 * server render that fetches only its own data.
 */

import { MobileNavDock } from "@/components/mobile-nav-dock";
import { PLAYER_NAV_ITEMS, playerTabHref, type PlayerTabId } from "./nav-items";

export type { PlayerTabId } from "./nav-items";

export function PlayerTabs({
  slug,
  activeTab,
  source,
  format,
}: {
  slug: string;
  activeTab: PlayerTabId;
  source?: string;
  format?: string;
}) {
  const current =
    PLAYER_NAV_ITEMS.find((item) => item.id === activeTab) ?? PLAYER_NAV_ITEMS[0];

  return (
    // lg:hidden on the wrapper as well as the dock, so the padding it carries
    // does not leave a band of empty page above the section body on desktop.
    <div className="px-4 pt-4 sm:px-6 lg:hidden">
      <MobileNavDock
        hideAboveClass="lg:hidden"
        menus={[
          {
            key: "sections",
            eyebrow: "Section",
            currentLabel: current.label,
            heading: "Player sections",
            summary: "Overview, statistics, trades, and coverage",
            icon: "userCircle",
            activeId: activeTab,
            items: PLAYER_NAV_ITEMS.map((item) => ({
              id: item.id,
              label: item.label,
              hint: item.hint,
              icon: item.icon,
              href: playerTabHref(slug, item.id, source, format),
            })),
          },
        ]}
      />
    </div>
  );
}
