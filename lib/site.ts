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

/** Footer-link shape. `disabled` links render as a non-interactive
 * placeholder (the destination doesn't exist yet) so we don't ship broken
 * navigation. Swap to `disabled: false` (or drop the flag) once the page lands. */
export type FooterLink = {
  label: string;
  href: string;
  disabled?: boolean;
};

export const FOOTER_COLUMNS: Array<{ heading: string; links: FooterLink[] }> = [
  {
    heading: "Tools",
    links: [
      { label: "Rankings Board", href: "/rankings" },
      { label: "Sleeper League Sync", href: "/tools/league-sync" },
      { label: "FAAB Calculator", href: "/tools/faab" },
    ],
  },
  {
    heading: "Learn",
    links: [
      { label: "Guides", href: "/guides" },
      { label: "Fantasy Analytics 101", href: "/guides/fantasy-analytics-101", disabled: true },
      { label: "Accessible Fantasy Football", href: "/guides/accessible-fantasy-football", disabled: true },
    ],
  },
  {
    heading: "Site",
    links: [
      { label: "About", href: "/about" },
      { label: "Author", href: "/author/michael" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
    ],
  },
];

/**
 * Social profiles shown as icons in the footer About column. All four
 * are placeholders for now — the renderer treats `disabled: true` as a
 * non-interactive icon (still labeled, still styled, but no navigation)
 * so the brand row reads correctly before the accounts exist.
 */
export const SOCIAL_LINKS: Array<{
  label: "Facebook" | "Instagram" | "X" | "TikTok";
  href: string;
  /** Whether the link opens a third-party site. Ignored when disabled. */
  external: boolean;
  /** Hide the actual navigation while the social account isn't claimed yet. */
  disabled?: boolean;
}> = [
  { label: "Facebook", href: "#", external: true, disabled: true },
  { label: "Instagram", href: "#", external: true, disabled: true },
  { label: "X", href: "#", external: true, disabled: true },
  { label: "TikTok", href: "#", external: true, disabled: true },
];

export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type Position = (typeof POSITIONS)[number];

export const DEFAULT_FORMAT_SLUG = "redraft-ppr-std";
