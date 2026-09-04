"use client";

/**
 * Switching Manager Pulse report section on a phone.
 *
 * The eight sections live in the site navigation rail from lg up
 * (manager-rail-sections.tsx), which does not exist below that breakpoint. So
 * below lg the report carries its own docking bar naming the section a reader
 * is on and opening a sheet of the other seven, same pattern League Pulse uses
 * (components/league-shell/league-mobile-nav.tsx) and the same
 * components/mobile-nav-dock.tsx underneath.
 *
 * Reads MANAGER_NAV_ITEMS and useManagerActiveSection so this can never list a
 * section the rail does not, or disagree with the rail about which one is
 * current.
 */

import { MobileNavDock } from "@/components/mobile-nav-dock";
import { MANAGER_NAV_ITEMS, managerSectionHref } from "./nav-items";
import { useManagerActiveSection } from "./manager-rail-sections";

export function ManagerMobileNav() {
  const activeId = useManagerActiveSection();
  const current = MANAGER_NAV_ITEMS.find((item) => item.id === activeId) ?? MANAGER_NAV_ITEMS[0];

  return (
    <MobileNavDock
      hideAboveClass="lg:hidden"
      className="mt-6"
      menus={[
        {
          key: "sections",
          eyebrow: "Section",
          currentLabel: current.label,
          heading: "Report sections",
          summary: "Results, drafting, trading, and how to deal with them",
          icon: "radio",
          activeId,
          items: MANAGER_NAV_ITEMS.map((item) => ({
            id: item.id,
            label: item.label,
            hint: item.hint,
            icon: item.icon,
            href: managerSectionHref(item.id),
          })),
        },
      ]}
    />
  );
}
