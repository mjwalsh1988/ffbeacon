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
    /**
     * The full legal name, used ONLY where a contract or a privacy notice has to
     * name a real party: the Terms of Service and the Privacy Policy. Everywhere
     * else on the site the byline is the first name, which is the voice the
     * product is written in. A binding agreement with a first name in it is
     * harder to enforce, so the two are kept apart rather than one being
     * promoted over the other.
     */
    legalName: "Michael Walsh",
    bylineHref: "/author/michael",
  },
  /** Where legal notices, privacy requests and data-deletion requests land. */
  legalContactEmail: "michael@ffbeacon.com",
  /** Whose law governs the Terms, and where a dispute is heard. */
  governingState: "Indiana",
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
 * by the navigation rail (via lib/nav-tree.ts) and the footer Tools column.
 * Keep descriptions short and jargon-free. */
// Ordered by how much of a manager's season the tool covers, widest first:
// a whole league, then a draft, then a single trade, then two players, then one
// waiver bid. The footer Tools column follows the same order. Rankings Board is
// intentionally not listed here (it is its own top-level nav item).
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
    label: "Manager Pulse",
    href: "/tools/manager-pulse",
    description: "Scout any manager before you offer",
  },
  {
    // The menu label is the job, not the product name: nobody looking for a
    // trade calculator searches for "Signal Check". The brand name stays in the
    // hint under it, and on the tool's own page.
    label: "Trade Calculator",
    href: "/tools/trade-calculator",
    description: "Signal Check: grade any trade with the Beacon Verdict",
  },
  {
    label: "Start / Sit",
    href: "/tools/who-should-i-start",
    description: "Beacon Breakdown: who should I start this week",
  },
  {
    label: "FAAB Calculator",
    href: "/tools/faab",
    description: "Recommended waiver bid ranges",
  },
];

/** Every game on the site, in display order. Single source of truth shared
 * by the navigation rail (via lib/nav-tree.ts) and the footer Games column.
 * Keep descriptions short and jargon-free. */
export const GAMES_NAV: NavChild[] = [
  {
    label: "Signal Scout",
    href: "/games/signal-scout",
    description: "Decode the profile. Find the player.",
  },
  {
    label: "Would You Rather?",
    href: "/games/would-you-rather",
    description: "Two sides of a real trade. One vote.",
  },
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
 * Descriptions track TOOLS_NAV closely but are not required to match it: the
 * nav hint carries the brand name for a reader who only sees "Trade Calculator"
 * in the menu, and a search result already shows the fuller label. */
export const SEARCHABLE_TOOLS: SearchableTool[] = [
  {
    label: "Rankings Board",
    href: "/rankings",
    description: "Full player and pick rankings for every format",
    keywords: ["rankings", "board", "values", "tiers", "adp"],
  },
  {
    label: "Signal Check Trade Calculator",
    href: "/tools/trade-calculator",
    description: "Grade any trade with the Beacon Verdict",
    keywords: [
      "trade",
      "grade",
      "calculator",
      "trade calculator",
      "fantasy football trade calculator",
      "analyzer",
      "trade analyzer",
      "verdict",
      "signal check",
    ],
  },
  {
    label: "Start / Sit (Beacon Breakdown)",
    href: "/tools/who-should-i-start",
    description: "Beacon Breakdown: who should I start this week",
    keywords: [
      "start",
      "sit",
      "who should i start",
      "who do i start",
      "start sit",
      "start or sit",
      "lineup",
      "compare",
      "comparison",
      "versus",
      "vs",
      "player",
      "breakdown",
      "head to head",
    ],
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
    label: "Manager Pulse",
    href: "/tools/manager-pulse",
    description: "Scout any manager before you offer",
    keywords: [
      "manager",
      "owner",
      "scout",
      "history",
      "tendencies",
      "who",
      "opponent",
      "trade partner",
    ],
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
    label: "Would You Rather?",
    href: "/games/would-you-rather",
    description: "Two sides of a real trade. One vote.",
    keywords: [
      "game",
      "games",
      "would you rather",
      "vote",
      "poll",
      "trade",
      "trades",
      "who won",
      "wyr",
    ],
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
  {
    label: "Fantasy Football Terms",
    href: "/guides/fantasy-football-terms",
    description: "Glossary of every fantasy term, in plain English",
    keywords: [
      "terms",
      "glossary",
      "definitions",
      "jargon",
      "abbreviations",
      "ppr",
      "superflex",
      "faab",
      "adp",
      "what does",
      "meaning",
    ],
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
    // Same order as TOOLS_NAV. Rankings Board used to be appended here; it is a
    // reference board rather than something you operate on your own league, so
    // it now sits under Learn beside the guides.
    links: [
      { label: "Sleeper League Pulse", href: "/tools/league-pulse" },
      { label: "On The Clock", href: "/tools/on-the-clock" },
      { label: "Manager Pulse", href: "/tools/manager-pulse" },
      { label: "Trade Calculator", href: "/tools/trade-calculator" },
      { label: "Start / Sit", href: "/tools/who-should-i-start" },
      { label: "FAAB Calculator", href: "/tools/faab" },
    ],
  },
  {
    heading: "Games",
    links: [
      { label: "All Games", href: "/games" },
      { label: "Signal Scout", href: "/games/signal-scout" },
      { label: "Would You Rather?", href: "/games/would-you-rather" },
    ],
  },
  {
    heading: "Learn",
    links: [
      { label: "The Beacon Brief", href: "/brief" },
      { label: "Guides", href: "/guides" },
      { label: "Fantasy Football Terms", href: "/guides/fantasy-football-terms" },
      // Was pointed at /guides/2026-fantasy-football-draft-guide, which does not
      // exist, and was disabled to hide that. The guide is real and lives at the
      // year-free path, so the link now goes to it.
      { label: "Draft Guide", href: "/guides/fantasy-football-draft-guide" },
      { label: "How FF Beacon Works", href: "/guides/how-ff-beacon-works" },
      // Rankings Board moved here from Tools: it is something you read rather
      // than something you run against your own league.
      { label: "Rankings Board", href: "/rankings" },
    ],
  },
  {
    heading: "Site",
    links: [
      { label: "About", href: "/about" },
      { label: "Author", href: "/author/michael" },
      // The header's Donate button is the fast path; this is the one people can
      // find again later, and the one that survives being pasted into a message.
      { label: "Donate", href: "/donate" },
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
