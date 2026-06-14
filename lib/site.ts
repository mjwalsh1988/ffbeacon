export const SITE = {
  name: "FF Beacon",
  shortName: "Beacon",
  tagline: "Your signal through the fantasy noise.",
  /** Short paragraph for the footer About column. Keep it under ~30 words so
   * it sits comfortably alongside the other footer columns. */
  about:
    "Fantasy football tools built for everyone. Rankings, league sync, and waiver bids in plain English that work the same by eye or by ear.",
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
      { label: "Sleeper League Pulse", href: "/tools/league-pulse" },
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
 * Social profiles shown as icons in the footer About column. The Discord
 * link points at the internal /join redirect so the shareable URL on
 * marketing posts is `ffbeacon.com/join` rather than the raw invite — the
 * route serves an OG-branded landing page and then forwards the visitor.
 */
export const SOCIAL_LINKS: Array<{
  label: "Instagram" | "X" | "TikTok" | "Discord";
  href: string;
  /** Whether the link opens in a new tab. The footer renderer reads this
   * flag to set target="_blank" + rel="noopener noreferrer" and to append
   * "(opens in new tab)" to the aria-label. Discord is internal (/join)
   * but still opens in a new tab so visitors don't lose their FF Beacon
   * session when they go grab the invite. */
  external: boolean;
  /** Hide the actual navigation while the social account isn't claimed yet. */
  disabled?: boolean;
}> = [
  { label: "Instagram", href: "https://instagram.com/ffbeacon", external: true },
  { label: "X", href: "https://x.com/ffbeacon", external: true },
  { label: "TikTok", href: "https://tiktok.com/@ffbeacon", external: true },
  { label: "Discord", href: "/join", external: true },
];

export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type Position = (typeof POSITIONS)[number];

export const DEFAULT_FORMAT_SLUG = "redraft-ppr-std";

// NOTE: the default data source is no longer a hardcoded constant. It lives in
// source_registry.is_default (admin-editable on /admin/beacon/sources) and is
// resolved via pickDefaultSource() in lib/source.ts. See migration 0053.
