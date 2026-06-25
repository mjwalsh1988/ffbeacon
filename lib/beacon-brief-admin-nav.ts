/**
 * Registry of The Beacon Brief admin sub-pages. Single source of truth for both
 * the parent landing index and the in-section sub-navigation, so adding a
 * sub-page is one edit and it appears in both places.
 */

export const BEACON_BRIEF_SUBPAGES = [
  {
    href: "/admin/beacon-brief/sources",
    label: "Sources",
    description:
      "Add, edit, toggle, and remove the accounts the curation cron monitors.",
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
      "Every Beacon Brief article: filter, edit assignments and body, and view revision history.",
  },
  {
    href: "/admin/beacon-brief/moderation",
    label: "Moderation",
    description:
      "Review detected source-post deletions and approve or reject the retraction.",
  },
  {
    href: "/admin/beacon-brief/filtered",
    label: "Filtered",
    description:
      "Posts held back as non-football by the keyword or AI filter. Delete them or force them through the pipeline.",
  },
  {
    href: "/admin/beacon-brief/logs",
    label: "Logs",
    description:
      "The full event log: ingestion, AI calls with prompts, Discord, and errors.",
  },
  {
    href: "/admin/beacon-brief/settings",
    label: "Settings",
    description:
      "Toggles, models, web search, thresholds, the webhook, and every editable prompt.",
  },
] as const;
