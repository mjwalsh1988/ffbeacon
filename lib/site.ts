export const SITE = {
  name: "FF Beacon",
  shortName: "Beacon",
  tagline: "Your signal through the fantasy noise.",
  /** Brand mission blurb for the footer About column. Focuses on the community
   * and the welcome, not on specific tools. Keep it under ~30 words so it sits
   * comfortably alongside the other footer columns. */
  about:
    "Fantasy football for everyone. We're building a welcoming, supportive community where every manager belongs, whether you're new to the game, a lifelong veteran, or playing by ear.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://ffbeacon.com",
  author: {
    name: "Michael",
    bylineHref: "/author/michael",
  },
};

import type { Route } from "next";

/** A second-level navigation entry rendered inside a parent's dropdown
 * (desktop) and as an indented sub-link (mobile). */
export type NavChild = {
  label: string;
  href: Route;
  /** Short plain-language summary shown under the label in the dropdown. */
  description: string;
};

/** A top-level navigation entry. When `children` is present the desktop
 * header renders it as an accessible disclosure dropdown and the mobile
 * menu surfaces the children as indented sub-links. */
export type NavItem = {
  label: string;
  href: Route;
  children?: NavChild[];
  /** Label for the dropdown's index-page entry (the row that links to
   * `href` itself, above the children). Defaults to "All tools" in
   * NavDropdown for backward compatibility when omitted. */
  overviewLabel?: string;
  /** Description line for the dropdown's index-page entry. Defaults to
   * "See every tool on one page" in NavDropdown when omitted. */
  overviewDescription?: string;
};

/** Every tool on the site, in display order. Single source of truth shared
 * by the header dropdown, the mobile menu, and (conceptually) the footer
 * Tools column. Keep descriptions short and jargon-free. */
// Order mirrors the homepage tools grid (minus Rankings, which is its own
// top-level nav item). Rankings Board is intentionally not listed here.
export const TOOLS_NAV: NavChild[] = [
  {
    label: "Sleeper League Pulse",
    href: "/tools/league-pulse",
    description: "Sync and analyze your Sleeper leagues",
  },
  {
    label: "On The Clock",
    href: "/tools/on-the-clock",
    description: "Live Sleeper draft helper",
  },
  {
    label: "Beacon Breakdown",
    href: "/tools/beacon-breakdown",
    description: "Compare two players head-to-head",
  },
  {
    label: "Signal Check",
    href: "/tools/signal-check",
    description: "Grade any trade with the Beacon Verdict",
  },
  {
    label: "FAAB Calculator",
    href: "/tools/faab",
    description: "Recommended waiver bid ranges",
  },
];

/** Every game on the site, in display order. Single source of truth shared
 * by the header dropdown, the mobile menu, and (conceptually) the footer
 * Games column. Keep descriptions short and jargon-free. */
export const GAMES_NAV: NavChild[] = [
  {
    label: "Signal Scout",
    href: "/games/signal-scout",
    description: "Decode the profile. Find the player.",
  },
];

export const PRIMARY_NAV: NavItem[] = [
  { label: "Tools", href: "/tools", children: TOOLS_NAV },
  {
    label: "Games",
    href: "/games",
    children: GAMES_NAV,
    overviewLabel: "All Games",
    overviewDescription: "See every game on one page",
  },
  { label: "Rankings", href: "/rankings" },
  { label: "The Beacon Brief", href: "/brief" },
  { label: "Guides", href: "/guides" },
  { label: "About", href: "/about" },
];

/** A destination the site search can match on the client. Tools and top-level
 * pages are a tiny fixed set, so the header search filters this list locally
 * instead of hitting the DB for them. `keywords` broadens what a label matches
 * (for example "trade" -> Signal Check). Keep keywords lowercase. */
export type SearchableTool = {
  label: string;
  href: Route;
  description: string;
  keywords: string[];
};

/** Tools + primary destinations, in the order the search palette lists them.
 * Descriptions are reused verbatim from TOOLS_NAV where they exist. */
export const SEARCHABLE_TOOLS: SearchableTool[] = [
  {
    label: "Rankings Board",
    href: "/rankings",
    description: "Full player and pick rankings for every format",
    keywords: ["rankings", "board", "values", "tiers", "adp"],
  },
  {
    label: "Signal Check",
    href: "/tools/signal-check",
    description: "Grade any trade with the Beacon Verdict",
    keywords: ["trade", "grade", "calculator", "analyzer", "verdict"],
  },
  {
    label: "Beacon Breakdown",
    href: "/tools/beacon-breakdown",
    description: "Compare two players head-to-head",
    keywords: ["compare", "comparison", "versus", "vs", "player", "breakdown", "head to head"],
  },
  {
    label: "On The Clock",
    href: "/tools/on-the-clock",
    description: "Live Sleeper draft helper",
    keywords: ["draft", "sleeper", "board", "pick", "live"],
  },
  {
    label: "Sleeper League Pulse",
    href: "/tools/league-pulse",
    description: "Sync and analyze your Sleeper leagues",
    keywords: ["league", "sleeper", "sync", "power rankings", "transactions"],
  },
  {
    label: "FAAB Calculator",
    href: "/tools/faab",
    description: "Recommended waiver bid ranges",
    keywords: ["faab", "waiver", "bid", "budget", "add"],
  },
  {
    label: "Signal Scout",
    href: "/games/signal-scout",
    description: "Decode the profile. Find the player.",
    keywords: ["game", "games", "guess", "mystery", "player", "scout", "clues", "trivia"],
  },
  {
    label: "Games",
    href: "/games",
    description: "Free fantasy football games built on real data",
    keywords: ["games", "play", "fun", "arcade"],
  },
  {
    label: "The Beacon Brief",
    href: "/brief",
    description: "Fantasy football news, injuries, and transactions",
    keywords: ["news", "brief", "articles", "injuries", "transactions", "blog"],
  },
  {
    label: "Guides",
    href: "/guides",
    description: "Plain-English fantasy football explainers",
    keywords: ["guides", "learn", "help", "how to", "strategy"],
  },
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
      { label: "Sleeper League Pulse", href: "/tools/league-pulse" },
      { label: "On The Clock", href: "/tools/on-the-clock" },
      { label: "Beacon Breakdown", href: "/tools/beacon-breakdown" },
      { label: "Signal Check", href: "/tools/signal-check" },
      { label: "FAAB Calculator", href: "/tools/faab" },
      { label: "Rankings Board", href: "/rankings" },
    ],
  },
  {
    heading: "Games",
    links: [
      { label: "All Games", href: "/games" },
      { label: "Signal Scout", href: "/games/signal-scout" },
    ],
  },
  {
    heading: "Learn",
    links: [
      { label: "The Beacon Brief", href: "/brief" },
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
 * marketing posts is `ffbeacon.com/join` rather than the raw invite, since the
 * route serves an OG-branded landing page and then forwards the visitor.
 */
export const SOCIAL_LINKS: Array<{
  label: "Instagram" | "X" | "TikTok" | "YouTube" | "Discord";
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
  { label: "Discord", href: "/join", external: true },
  { label: "X", href: "https://x.com/ffbeacon", external: true },
  { label: "TikTok", href: "https://tiktok.com/@ffbeacon", external: true },
  { label: "YouTube", href: "https://www.youtube.com/@FFBeacon", external: true },
  { label: "Instagram", href: "https://instagram.com/ffbeacon", external: true },
];

export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type Position = (typeof POSITIONS)[number];

export const DEFAULT_FORMAT_SLUG = "redraft-ppr-std";

// NOTE: the default data source is no longer a hardcoded constant. It lives in
// source_registry.is_default (admin-editable on /admin/beacon/sources) and is
// resolved via pickDefaultSource() in lib/source.ts. See migration 0053.
