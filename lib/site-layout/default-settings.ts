/**
 * The site layout an admin edits at /admin/site-layout, and what it falls back
 * to when nothing is stored.
 *
 * Four things, each its own list:
 *
 *   menu.sectionOrder    the top level of the navigation rail and mobile drawer
 *   menu.toolOrder       the Tools submenu, and the footer Tools column with it
 *   toolsPage.toolOrder  the sections on /tools
 *   homepage.cards       the tool cards on the homepage, in order, each with a
 *                        width, an optional tag and an optional highlight
 *
 * The defaults are the layout the site carried when this became editable
 * (2026-09-14), and migration 0282 seeds the stored row with exactly the same
 * values, so turning the feature on changed nothing a reader could see.
 *
 * Client-safe on purpose: the admin form imports the catalogs below to draw its
 * selects. Nothing here touches the database.
 */

import { TOOL_CATALOG, type ToolHref } from "@/lib/tools-catalog";

/** Every tool, in the catalog's own order. */
export const TOOL_HREFS: readonly ToolHref[] = TOOL_CATALOG.map((tool) => tool.href);

/** A tool's full name, for the admin form. */
export const TOOL_TITLES: Record<ToolHref, string> = Object.fromEntries(
  TOOL_CATALOG.map((tool) => [tool.href, tool.title]),
) as Record<ToolHref, string>;

/**
 * The top-level sections of the navigation, by the ids `lib/nav-tree.ts` gives
 * them. `lib/site-layout/parse.test.ts` fails if the two ever disagree.
 */
export const NAV_SECTION_IDS = [
  "home",
  "tools",
  "rankings",
  "waiver-wire",
  "games",
  "brief",
  "guides",
  "my-beacon",
  "about",
  "admin",
] as const;

export type NavSectionId = (typeof NAV_SECTION_IDS)[number];

/**
 * What the admin form calls each section. The two gated sections say who sees
 * them, because an admin reordering the menu sees all nine and a signed-out
 * reader sees seven.
 */
export const NAV_SECTION_LABELS: Record<NavSectionId, string> = {
  home: "Home",
  tools: "Tools",
  rankings: "Rankings",
  "waiver-wire": "Waiver Wire",
  games: "Games",
  brief: "The Beacon Brief",
  guides: "Guides",
  "my-beacon": "My Beacon (signed-in readers only)",
  about: "About",
  admin: "Admin (admins only)",
};

/** The colour a tag's pill is filled with. */
export type ToolBadgeTone = "beacon" | "cyan" | "green" | "amber";

/** The icon inside a tag's pill. Resolved to a component in components/tool-badge.tsx. */
export type ToolBadgeIcon =
  | "flame"
  | "sparkles"
  | "zap"
  | "refresh"
  | "flask"
  | "alarm"
  | "trophy"
  | "graduation"
  | "star";

export type ToolBadgeDefinition = {
  label: string;
  tone: ToolBadgeTone;
  icon: ToolBadgeIcon;
  /** When an admin would reach for it. Shown in the form, never on the site. */
  use: string;
};

/**
 * Every tag a homepage card can carry. The first three are the ones the site
 * has used; the rest follow the football calendar. Adding one is a new entry
 * here and nothing else.
 */
export const TOOL_BADGES = {
  "new-tool": {
    label: "New tool",
    tone: "cyan",
    icon: "sparkles",
    use: "A tool that has just launched.",
  },
  "new-features": {
    label: "New features",
    tone: "green",
    icon: "zap",
    use: "An existing tool that has grown.",
  },
  "draft-season": {
    label: "Draft season",
    tone: "beacon",
    icon: "flame",
    use: "The seasonal push for the draft room, July to early September.",
  },
  "rookie-drafts": {
    label: "Rookie drafts",
    tone: "cyan",
    icon: "graduation",
    use: "Dynasty rookie draft season, spring into summer.",
  },
  "trade-deadline": {
    label: "Trade deadline",
    tone: "amber",
    icon: "alarm",
    use: "The weeks before most leagues lock trades.",
  },
  "playoff-push": {
    label: "Playoff push",
    tone: "beacon",
    icon: "trophy",
    use: "The last weeks of the regular season and the fantasy playoffs.",
  },
  updated: {
    label: "Updated",
    tone: "green",
    icon: "refresh",
    use: "A smaller change than New features: a fix or a refresh.",
  },
  beta: {
    label: "Beta",
    tone: "amber",
    icon: "flask",
    use: "Live, but still being tuned.",
  },
  popular: {
    label: "Popular",
    tone: "beacon",
    icon: "star",
    use: "Whatever readers are opening most right now.",
  },
} as const satisfies Record<string, ToolBadgeDefinition>;

export type ToolBadgeKey = keyof typeof TOOL_BADGES;

export const TOOL_BADGE_KEYS = Object.keys(TOOL_BADGES) as ToolBadgeKey[];

/** The accent a highlighted card's border and corner glow are drawn in. */
export const HIGHLIGHT_COLORS = ["purple", "cyan", "green", "amber"] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export const HIGHLIGHT_LABELS: Record<HighlightColor, string> = {
  purple: "Purple",
  cyan: "Cyan",
  green: "Green",
  amber: "Amber",
};

/**
 * The highlight a tag suggests when an admin switches the highlight on. Only a
 * suggestion: the colour is still its own choice afterwards.
 */
export const TONE_TO_HIGHLIGHT: Record<ToolBadgeTone, HighlightColor> = {
  beacon: "purple",
  cyan: "cyan",
  green: "green",
  amber: "amber",
};

/**
 * How many of the homepage grid's columns a card spans. The grid is three
 * columns wide from `md`, two from `sm`, and one below that, so a wide card is
 * capped at the columns there are and every card is full width on a phone.
 */
export const CARD_WIDTHS = [1, 2, 3] as const;

export type CardWidth = (typeof CARD_WIDTHS)[number];

export const CARD_WIDTH_LABELS: Record<CardWidth, string> = {
  1: "One column",
  2: "Two columns",
  3: "Full row",
};

export type HomepageToolCard = {
  href: ToolHref;
  width: CardWidth;
  badge: ToolBadgeKey | null;
  highlight: HighlightColor | null;
};

export type SiteLayoutSettings = {
  menu: {
    sectionOrder: NavSectionId[];
    toolOrder: ToolHref[];
  };
  toolsPage: {
    toolOrder: ToolHref[];
  };
  homepage: {
    cards: HomepageToolCard[];
  };
};

const IN_SEASON_TOOL_ORDER: ToolHref[] = [
  "/tools/league-pulse",
  "/tools/trade-calculator",
  "/tools/who-should-i-start",
  "/tools/faab",
  "/tools/manager-pulse",
  "/tools/on-the-clock",
];

export const DEFAULT_SITE_LAYOUT: SiteLayoutSettings = {
  menu: {
    sectionOrder: [...NAV_SECTION_IDS],
    toolOrder: [...IN_SEASON_TOOL_ORDER],
  },
  toolsPage: {
    toolOrder: [...IN_SEASON_TOOL_ORDER],
  },
  homepage: {
    cards: [
      { href: "/tools/league-pulse", width: 1, badge: "new-features", highlight: "green" },
      { href: "/tools/trade-calculator", width: 1, badge: null, highlight: null },
      { href: "/tools/who-should-i-start", width: 1, badge: "new-features", highlight: "green" },
      { href: "/tools/faab", width: 1, badge: null, highlight: null },
      { href: "/tools/manager-pulse", width: 1, badge: "new-tool", highlight: "cyan" },
      { href: "/tools/on-the-clock", width: 1, badge: null, highlight: null },
    ],
  },
};

/** A card for a tool the stored row has never heard of: plain, one column. */
export function plainCard(href: ToolHref): HomepageToolCard {
  return { href, width: 1, badge: null, highlight: null };
}
