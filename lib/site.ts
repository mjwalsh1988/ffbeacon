export const SITE = {
  name: "FF Beacon",
  shortName: "Beacon",
  tagline: "Your signal through the fantasy noise.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://ffbeacon.com",
  author: {
    name: "Michael",
    bylineHref: "/author/michael",
  },
};

export const PRIMARY_NAV = [
  { label: "Tools", href: "/tools" as const },
  { label: "Rankings", href: "/rankings" as const },
  { label: "Players", href: "/players" as const },
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
    heading: "Players",
    links: [
      { label: "Quarterbacks", href: "/rankings?position=QB" as const },
      { label: "Running Backs", href: "/rankings?position=RB" as const },
      { label: "Wide Receivers", href: "/rankings?position=WR" as const },
      { label: "Tight Ends", href: "/rankings?position=TE" as const },
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

export const SOCIAL_LINKS = [
  { label: "Discord", href: "https://discord.gg/ffbeacon", external: true },
  { label: "X / Twitter", href: "https://x.com/ffbeacon", external: true },
  { label: "Email", href: "mailto:hello@ffbeacon.com", external: false },
];

export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type Position = (typeof POSITIONS)[number];

export const DEFAULT_FORMAT_SLUG = "redraft-ppr-std";
