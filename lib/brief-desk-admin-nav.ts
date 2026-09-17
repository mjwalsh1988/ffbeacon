/**
 * Registry of the Brief desk admin sub-pages. Single source of truth for the
 * overview tiles and the in-section sub-navigation, so adding a sub-page is
 * one edit and it appears in both places. Same shape as
 * lib/beacon-brief-admin-nav.ts.
 */

export const BRIEF_DESK_SUBPAGES = [
  {
    href: "/admin/brief-desk/editions",
    label: "Editions",
    description:
      "Every edition of The Beacon Brief by period: review the draft, edit its words, approve and publish, or reject with notes.",
  },
  {
    href: "/admin/brief-desk/relays",
    label: "Relays",
    description:
      "Search and filter every Relay. Hide, unhide or retract one, or edit its headline and facts and publish it when it grounds.",
  },
  {
    href: "/admin/brief-desk/settings",
    label: "Settings",
    description:
      "Cadence, the close time, the minimum Relay count, the editorial instructions and the Relay extraction prompt.",
  },
] as const;
