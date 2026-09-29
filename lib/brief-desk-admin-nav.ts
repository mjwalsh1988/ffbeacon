/**
 * Registry of the Beacon Desk admin sub-pages. Single source of truth for the
 * overview tiles and the in-section sub-navigation, so adding a sub-page is
 * one edit and it appears in both places.
 *
 * ONE ADMIN AREA. Until 2026-09-29 this was two: "The Beacon Brief" (sources,
 * categories, moderation, the filtered queue, logs, curation settings) and
 * "Brief desk" (editions, Relays, desk settings). They are one pipeline, the
 * first half feeding the second, and running them as two sections meant a
 * hidden Relay was reviewed in both. The pages keep their URLs, because alert
 * emails and bookmarks link to them, and every one of them now carries this
 * one menu under one heading.
 *
 * `exact` marks the one entry whose href is a prefix of its siblings' hrefs
 * (the curation overview at /admin/beacon-brief), so it is current only on
 * its own page.
 */

export type DeskSubpage = {
  href: string;
  label: string;
  description: string;
  exact?: boolean;
};

export const BRIEF_DESK_SUBPAGES: readonly DeskSubpage[] = [
  {
    href: "/admin/brief-desk/relays",
    label: "Relays",
    description:
      "Relays waiting for your review, then every Relay. Edit and publish, publish anyway, keep hidden, or retract.",
  },
  {
    href: "/admin/brief-desk/editions",
    label: "Editions",
    description:
      "Every edition of The Beacon Brief by period: review the draft, edit its words, approve and publish, or reject with notes.",
  },
  {
    href: "/admin/beacon-brief/moderation",
    label: "Moderation",
    description:
      "Deleted source posts, player and team names that need matching, and failed Discord or deletion tasks.",
  },
  {
    href: "/admin/beacon-brief/filtered",
    label: "Filtered",
    description:
      "Posts held back as non-football by the keyword or AI filter. Delete them or force them through the pipeline.",
  },
  {
    href: "/admin/beacon-brief/sources",
    label: "Sources",
    description: "Add, edit, toggle, and remove the accounts the curation cron monitors.",
  },
  {
    href: "/admin/beacon-brief/categories",
    label: "Categories",
    description:
      "Manage the category set the AI picks from, and the Discord roles each one pings.",
  },
  {
    href: "/admin/beacon-brief/articles",
    label: "Articles",
    description:
      "Every article record, including published editions: filter, edit assignments and body, and view revision history.",
  },
  {
    href: "/admin/beacon-brief/logs",
    label: "Logs",
    description: "The full event log: ingestion, AI calls with prompts, Discord, and errors.",
  },
  {
    href: "/admin/beacon-brief",
    label: "Pipeline health",
    description:
      "Curation and worker cron runs, queue counts, the X API status, and recent activity.",
    exact: true,
  },
  {
    href: "/admin/brief-desk/settings",
    label: "Desk settings",
    description:
      "Cadence, the close time, the minimum Relay count, the editorial instructions and the Relay extraction prompt.",
  },
  {
    href: "/admin/beacon-brief/settings",
    label: "Curation settings",
    description: "Toggles, models, web search, thresholds, the webhook, and every editable prompt.",
  },
];
