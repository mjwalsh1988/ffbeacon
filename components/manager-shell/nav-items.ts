/**
 * The Manager Pulse section list, in one place. Both the desktop rail
 * (manager-rail-sections.tsx) and the mobile dock (manager-mobile-nav.tsx) read
 * from here, so a section can never appear in one and go missing from the
 * other.
 *
 * Manager Pulse is ONE page, not eight routes. League Pulse's rail links to a
 * separate URL per section; this one links to an in-page anchor instead, so
 * every id here doubles as the DOM id the matching section renders on (see
 * managerSectionElementId). The ids themselves are exactly `ManagerSection`
 * from lib/manager-pulse/types.ts, so a section component, its Suspense
 * boundary key, and its nav row all agree on one name.
 *
 * managerSectionElementId is the identity function for seven of the eight
 * sections: components/manager-pulse/section-frame.tsx renders `<section
 * id={id} class="scroll-mt-24">` with `id` set to the literal ManagerSection
 * string ("identity", "results", and so on), so the anchor this rail points at
 * has to match that exactly rather than a locally-invented prefix. The one
 * exception is `rosterOps`, whose own section passes `id="roster-ops"`
 * (kebab-case, unlike its camelCase ManagerSection key), so this is a lookup
 * against the real ids rather than a blind pass-through.
 *
 * "Overview" is the nav label for the `identity` section (docs/manager-pulse-
 * plan.md 6.1: who this is). The type keeps the engine's own name; the label is
 * what a reader sees.
 */

import type { NavIconName } from "@/components/app-shell/nav-icons";
import type { ManagerSection } from "@/lib/manager-pulse/types";

export type { ManagerSection };

export type ManagerNavItem = {
  id: ManagerSection;
  label: string;
  /** One line of plain description, carried in the rail row and the mobile
   *  sheet, and folded into the anchor link's accessible name. */
  hint: string;
  /** Name of the icon, resolved by components/app-shell/nav-icons.ts. */
  icon: NavIconName;
};

export const MANAGER_NAV_ITEMS: ManagerNavItem[] = [
  {
    id: "identity",
    label: "Overview",
    hint: "Who this is, and how many league-seasons we found",
    icon: "dashboard",
  },
  {
    id: "results",
    label: "Results",
    hint: "Record, championships, and playoff rate",
    icon: "trophy",
  },
  {
    id: "drafting",
    label: "Drafting",
    hint: "Reach, position shape, and draft pace",
    icon: "graduationCap",
  },
  {
    id: "affinity",
    label: "Who they like",
    hint: "Favourite players, and the ones they avoid",
    icon: "target",
  },
  {
    id: "trading",
    label: "Trading",
    hint: "Every trade, graded, and who they overpay for",
    icon: "handshake",
  },
  {
    id: "rosterOps",
    label: "Roster moves",
    hint: "Waivers, FAAB, and lineup efficiency",
    icon: "swap",
  },
  {
    id: "narrative",
    label: "How to deal",
    hint: "What the numbers above mean for a trade offer",
    icon: "signal",
  },
  {
    id: "leagues",
    label: "Leagues",
    hint: "Every league-season we counted",
    icon: "history",
  },
];

/** DOM ids that differ from their ManagerSection key. `rosterOps` is the only
 *  one: its section passes `id="roster-ops"` to SectionFrame. */
const ELEMENT_ID_OVERRIDES: Partial<Record<ManagerSection, string>> = {
  rosterOps: "roster-ops",
};

/** The DOM id a section's own container renders on. Its own `<section>`
 *  (via components/manager-pulse/section-frame.tsx) already carries
 *  `scroll-mt-24`, so a jump lands the heading clear of the site header and
 *  the mobile dock without this needing to add a wrapper of its own. */
export function managerSectionElementId(id: ManagerSection): string {
  return ELEMENT_ID_OVERRIDES[id] ?? id;
}

/** The in-page anchor href for one section's nav row. */
export function managerSectionHref(id: ManagerSection): string {
  return `#${managerSectionElementId(id)}`;
}
