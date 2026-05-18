export const SITE = {
  name: "FF Beacon",
  shortName: "Beacon",
  tagline: "Your signal through the fantasy noise.",
  /** Short paragraph for the footer About column. Keep it under ~30 words so
   * it sits comfortably alongside the other footer columns. */
  about:
    "Accessibility-first fantasy football tools — sortable rankings, FAAB and trade calculators, and Sleeper league insights, built to read clearly on every device.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://ffbeacon.com",
  author: {
    name: "Michael",
    bylineHref: "/author/michael",
  },
};

export const PRIMARY_NAV = [
  { label: "Tools", href: "/tools" as const },
  { label: "Rankings", href: "/rankings" as const },
  { label: "Guides", href: "/guides" as const },
  { label: "About", href: "/about" as const },
];

export const FOOTER_COLUMNS = [
  {
    heading: "Tools",
    links: [
      { label: "Rankings Board", href: "/rankings" as const },
      { label: "Sleeper League Sync", href: "/tools/league-sync" as const },
      { label: "FAAB Calculator", href: "/tools/faab" as const },
    ],
  },
  {
    heading: "Learn",
    links: [
      { label: "Guides", href: "/guides" as const },
      { label: "Fantasy Analytics 101", href: "/guides/fantasy-analytics-101" as const },
      { label: "Accessible Fantasy Football", href: "/guides/accessible-fantasy-football" as const },
    ],
  },
  {
    heading: "Site",
    links: [
      { label: "About", href: "/about" as const },
      { label: "Author", href: "/author/michael" as const },
      { label: "Privacy", href: "/privacy" as const },
    ],
  },
];

/**
 * Social profiles shown as icons in the footer About column. Placeholder
 * hrefs (#) for accounts that don't exist yet — swap them in once the
 * profiles are claimed. Order: Facebook, Instagram, X, TikTok.
 */
export const SOCIAL_LINKS: Array<{
  label: "Facebook" | "Instagram" | "X" | "TikTok";
  href: string;
  /** Whether the link opens a third-party site (true) or stays on ours
   * (false). Drives target="_blank" + rel attributes in the renderer. */
  external: boolean;
}> = [
  { label: "Facebook", href: "https://facebook.com/ffbeacon", external: true },
  { label: "Instagram", href: "https://instagram.com/ffbeacon", external: true },
  { label: "X", href: "https://x.com/ffbeacon", external: true },
  { label: "TikTok", href: "https://tiktok.com/@ffbeacon", external: true },
];

export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type Position = (typeof POSITIONS)[number];

export const DEFAULT_FORMAT_SLUG = "redraft-ppr-std";
