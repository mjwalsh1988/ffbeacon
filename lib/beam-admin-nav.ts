/**
 * Registry of the Ask BEAM admin sub-pages. One source of truth for the section
 * landing index and the in-section navigation, so adding a page is one edit and
 * it appears in both. Mirrors lib/beacon-admin-nav.ts.
 */

export const BEAM_SUBPAGES = [
  {
    href: "/admin/beam",
    label: "Settings",
    description:
      "Confidence thresholds for name and intent matching, input and rate limits, per-capability switches, and logging.",
  },
  {
    href: "/admin/beam/gaps",
    label: "Unanswered questions",
    description:
      "What people asked that BEAM could not answer, grouped and counted. The list that decides what gets built next.",
  },
  {
    href: "/admin/beam/requests",
    label: "Learning requests",
    description:
      "Submissions from the Help BEAM learn this form, with the question that failed and how to reach the person who asked.",
  },
  {
    href: "/admin/beam/aliases",
    label: "Player nicknames",
    description:
      "The editorial nickname map: what \"cmc\" and \"hollywood\" resolve to. Everything else the resolver does is algorithmic.",
  },
] as const;
