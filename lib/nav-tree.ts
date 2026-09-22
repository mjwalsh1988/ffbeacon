import "server-only";

/**
 * The site-wide navigation tree, in one place.
 *
 * This is the shape the app-shell rail reads on every page: a list of sections,
 * each of which may carry a list of children. A section with children opens a
 * second level in the rail rather than a dropdown, and that second level always
 * begins with a row pointing at the section's own index page, so `/tools` is
 * never stranded behind its own submenu.
 *
 * The tools and the games come from `lib/site.ts` (TOOLS_NAV, GAMES_NAV), so
 * the footer and the rail cannot drift on those. The top-level section labels
 * are written here, because the rail is now the only thing that renders them.
 * What this file adds is the icon name and the one-line hint, neither of which
 * the flat nav list carries.
 *
 * SERVER ONLY, and that is the point. This file lists every admin route on the
 * site. Filtering it in the browser would still have shipped the list to
 * everyone, which hands an anonymous visitor a map of the admin surface for the
 * cost of one request for the layout chunk. `buildNavTree` runs on the server
 * and the rail receives a tree already cut down to what the viewer can reach.
 * The types and the active-route lookup live in `lib/nav-types.ts`, which is
 * safe to import anywhere.
 *
 * Nodes name their icon rather than carrying the component, because a component
 * cannot cross the server-to-client boundary. See
 * `components/app-shell/nav-icons.ts`.
 */

import { cache } from "react";
import type { Route } from "next";
import { TOOLS_NAV, GAMES_NAV } from "@/lib/site";
import { applyOrder } from "@/lib/site-layout/order";
import type { SiteLayoutSettings } from "@/lib/site-layout/default-settings";
import type { NavNode, NavViewer, SiteNavNode } from "@/lib/nav-types";
import type { NavIconName } from "@/components/app-shell/nav-icons";

export type { NavNode, NavViewer, NavAudience } from "@/lib/nav-types";
export { findActiveTrail } from "@/lib/nav-types";

/** Icons for the tools, keyed by href so `lib/site.ts` stays presentation-free. */
const TOOL_ICONS: Record<string, NavIconName> = {
  "/tools/league-pulse": "workflow",
  "/tools/on-the-clock": "timer",
  "/tools/manager-pulse": "users",
  "/tools/trade-calculator": "scale",
  "/tools/who-should-i-start": "swords",
  "/tools/faab": "calculator",
};

const GAME_ICONS: Record<string, NavIconName> = {
  "/games/signal-scout": "radar",
  "/games/would-you-rather": "scale",
};

const toolChildren: SiteNavNode[] = TOOLS_NAV.map((tool) => ({
  id: tool.href,
  label: tool.label,
  href: tool.href as Route,
  hint: tool.description,
  icon: TOOL_ICONS[tool.href] ?? "wrench",
}));

const gameChildren: SiteNavNode[] = GAMES_NAV.map((game) => ({
  id: game.href,
  label: game.label,
  href: game.href as Route,
  hint: game.description,
  icon: GAME_ICONS[game.href] ?? "gamepad",
}));

/**
 * Every section the rail can show, before the audience filter. This is the
 * DEFAULT order; the rail paints them in the order stored at
 * /admin/site-layout (`layout.menu.sectionOrder`), and the Tools children in
 * `layout.menu.toolOrder`.
 */
const ALL_SECTIONS: SiteNavNode[] = [
  {
    id: "home",
    label: "Home",
    href: "/",
    hint: "The front page",
    icon: "home",
  },
  {
    id: "tools",
    label: "Tools",
    href: "/tools",
    hint: "Every tool on the site",
    icon: "wrench",
    indexLabel: "All tools",
    children: toolChildren,
  },
  {
    id: "rankings",
    label: "Rankings",
    href: "/rankings",
    hint: "Player and pick values for every format",
    icon: "listOrdered",
  },
  {
    // Its own top-level section rather than a child of Tools, because it is a
    // content area with eighteen weekly pages under it rather than one thing
    // you run against your league. The hub is the head term the section exists
    // for; the weekly boards are reached from it and from each other.
    id: "waiver-wire",
    label: "Waiver Wire",
    href: "/waiver-wire",
    hint: "Who to add this week, and what to bid",
    icon: "listChecks",
  },
  {
    id: "games",
    label: "Games",
    href: "/games",
    hint: "Free games built on real data",
    icon: "gamepad",
    indexLabel: "All games",
    children: gameChildren,
  },
  {
    id: "brief",
    label: "The Beacon Brief",
    href: "/brief",
    hint: "News, injuries, and transactions",
    icon: "newspaper",
  },
  {
    id: "guides",
    label: "Guides",
    href: "/guides",
    hint: "Plain-English explainers",
    icon: "book",
    indexLabel: "All guides",
    children: [
      {
        id: "/guides/fantasy-football-terms",
        label: "Fantasy Football Terms",
        href: "/guides/fantasy-football-terms",
        hint: "Every term, in plain English",
        icon: "book",
      },
      {
        id: "/guides/fantasy-football-draft-guide",
        label: "Draft Guide",
        href: "/guides/fantasy-football-draft-guide",
        hint: "How to draft, start to finish",
        icon: "layers",
      },
      {
        id: "/guides/positional-war-explained",
        label: "Positional WAR Explained",
        href: "/guides/positional-war-explained",
        hint: "Positional WAR, for beginners",
        icon: "barChart",
      },
      {
        id: "/guides/faab-strategy",
        label: "FAAB Strategy",
        href: "/guides/faab-strategy",
        hint: "How much to bid on waivers",
        icon: "calculator",
      },
      {
        id: "/guides/faab-settings-by-platform",
        label: "FAAB Settings",
        href: "/guides/faab-settings-by-platform",
        hint: "Waiver settings on every platform",
        icon: "settings",
      },
      {
        id: "/guides/chopped-league-strategy",
        label: "Chopped Leagues",
        href: "/guides/chopped-league-strategy",
        hint: "Guillotine, death and knockout leagues",
        icon: "swords",
      },
      {
        id: "/guides/fantasy-football-trade-guide",
        label: "Trade Guide",
        href: "/guides/fantasy-football-trade-guide",
        hint: "How to judge any trade",
        icon: "scale",
      },
      {
        id: "/guides/superflex-strategy",
        label: "Superflex Strategy",
        href: "/guides/superflex-strategy",
        hint: "Quarterbacks when everyone needs two",
        icon: "layers",
      },
      {
        id: "/guides/dynasty-strategy",
        label: "Dynasty Strategy",
        href: "/guides/dynasty-strategy",
        hint: "When to contend, when to rebuild",
        icon: "hourglass",
      },
      {
        id: "/guides/fantasy-football-playoffs",
        label: "Playoff Guide",
        href: "/guides/fantasy-football-playoffs",
        hint: "Your odds, the deadline, the title run",
        icon: "trophy",
      },
    ],
  },
  {
    id: "my-beacon",
    label: "My Beacon",
    href: "/my-beacon",
    hint: "Your leagues, boards, and Signal",
    icon: "userCircle",
    requires: "authenticated",
    indexLabel: "Dashboard",
    children: [
      {
        id: "/my-beacon/sleeper-leagues",
        label: "Sleeper Leagues",
        href: "/my-beacon/sleeper-leagues",
        hint: "Leagues saved to your account",
        icon: "users",
      },
      {
        id: "/my-beacon/bookmarks",
        label: "Bookmarks",
        href: "/my-beacon/bookmarks",
        hint: "Pages you saved, and the bar they sit in",
        icon: "bookmark",
      },
      {
        id: "/my-beacon/rankings",
        label: "Rankings Boards",
        href: "/my-beacon/rankings",
        hint: "Your own player order",
        icon: "layers",
      },
      {
        id: "/my-beacon/draft-tracker",
        label: "Draft Tracker",
        href: "/my-beacon/draft-tracker",
        hint: "Track a draft we cannot see",
        icon: "listChecks",
      },
      {
        id: "/my-beacon/signal",
        label: "Signal",
        href: "/my-beacon/signal",
        hint: "Your public profile",
        icon: "signal",
      },
      {
        id: "/my-beacon/profile",
        label: "Profile",
        href: "/my-beacon/profile",
        hint: "Name, avatar, and defaults",
        icon: "badgeCheck",
      },
      {
        id: "/my-beacon/account",
        label: "Account",
        href: "/my-beacon/account",
        hint: "Email, password, and sign out",
        icon: "settings",
      },
    ],
  },
  {
    id: "about",
    label: "About",
    href: "/about",
    hint: "Who builds FF Beacon and why",
    icon: "info",
  },
  {
    id: "admin",
    label: "Admin",
    href: "/admin",
    hint: "Run the site",
    icon: "shield",
    requires: "admin",
    indexLabel: "Overview",
    // The whole section is admin-gated above, so the children carry no
    // `requires` of their own. Order matches the old horizontal admin strip.
    children: [
      {
        id: "/admin/beacon",
        label: "Values, Rankings, & Sources",
        href: "/admin/beacon",
        hint: "Sources, weights, bands, and the ranking review",
        icon: "sliders",
      },
      {
        id: "/admin/beacon-brief",
        label: "The Beacon Brief",
        href: "/admin/beacon-brief",
        hint: "News curation, moderation, and logs",
        icon: "newspaper",
      },
      {
        id: "/admin/brief-desk",
        label: "Brief desk",
        href: "/admin/brief-desk",
        hint: "Editions, relays, and the desk settings",
        icon: "newspaper",
      },
      {
        id: "/admin/signal-check",
        label: "Signal Check",
        href: "/admin/signal-check",
        hint: "Trade analyzer thresholds and policy",
        icon: "scale",
      },
      {
        id: "/admin/faab",
        label: "FAAB Calculator",
        href: "/admin/faab",
        hint: "Bid curve, need multipliers, and copy",
        icon: "coins",
      },
      {
        id: "/admin/power-pulse",
        label: "Power Pulse Model",
        href: "/admin/power-pulse",
        hint: "Weights, recency, and the season simulation",
        icon: "activity",
      },
      {
        id: "/admin/manager-pulse",
        label: "Manager Pulse",
        href: "/admin/manager-pulse",
        hint: "Lookup limits, sample floors, and the report cache",
        icon: "gauge",
      },
      {
        id: "/admin/draft-value",
        label: "Beacon Steals Model",
        href: "/admin/draft-value",
        hint: "Draft board model and its thresholds",
        icon: "target",
      },
      {
        id: "/admin/projections",
        label: "Projection Scoreboard",
        href: "/admin/projections",
        hint: "Grade every projection source against what actually happened",
        icon: "barChart",
      },
      {
        id: "/admin/beam",
        label: "Ask BEAM",
        href: "/admin/beam",
        hint: "Assistant settings and the learning queue",
        icon: "question",
      },
      {
        id: "/admin/on-the-clock",
        label: "On The Clock Settings",
        href: "/admin/on-the-clock",
        hint: "Live draft helper limits and tuning",
        icon: "timer",
      },
      {
        id: "/admin/signal-scout",
        label: "Signal Scout",
        href: "/admin/signal-scout",
        hint: "Game activity, integrity, and settings",
        icon: "radar",
      },
      {
        id: "/admin/would-you-rather",
        label: "Would You Rather",
        href: "/admin/would-you-rather",
        hint: "Trade voting game, pool, and the Discord poll",
        icon: "scale",
      },
      {
        id: "/admin/league-relay",
        label: "League Relay",
        href: "/admin/league-relay",
        hint: "Community leagues, and what they post to Discord",
        icon: "radio",
      },
      {
        id: "/admin/site-layout",
        label: "Site Layout",
        href: "/admin/site-layout",
        hint: "Menu order, tool order, and the homepage tool cards",
        icon: "listOrdered",
      },
      {
        id: "/admin/system",
        label: "System Settings",
        href: "/admin/system",
        hint: "Site-wide configuration",
        icon: "settings",
      },
      {
        id: "/admin/signal",
        label: "Signal",
        href: "/admin/signal",
        hint: "Creator profile moderation",
        icon: "flag",
      },
      {
        id: "/admin/signal-guide",
        label: "Signal Guide",
        href: "/admin/signal-guide",
        hint: "Per-page help content",
        icon: "help",
      },
      {
        id: "/admin/crons",
        label: "Cron Logs",
        href: "/admin/crons",
        hint: "Every scheduled job run",
        icon: "history",
      },
    ],
  },
];

/**
 * Every top-level section id, in code order. `lib/site-layout/parse.test.ts`
 * holds the admin form's list of sections to this one.
 */
export const NAV_TREE_SECTION_IDS: string[] = ALL_SECTIONS.map(
  (section) => section.id,
);

/**
 * The sections one viewer can reach, in display order.
 *
 * React-cached on its arguments. The rail and the mobile drawer both need this
 * in the same render, and both are client components, so two calls means the
 * tree is serialised into the payload twice. Called with the object
 * `getNavViewer()` returns and the layout `loadSiteLayout()` returns (both
 * cached, so the same references both times) this returns the same array, and
 * the payload carries it once.
 *
 * The order is applied before the audience filter, so hiding a section from a
 * reader never shifts where the others sit relative to each other.
 */
export const buildNavTree = cache(
  (
    { isAuthenticated, isAdmin }: NavViewer,
    layout: SiteLayoutSettings,
  ): NavNode[] =>
    applyOrder(ALL_SECTIONS, layout.menu.sectionOrder, (section) => section.id)
      .filter((section) => {
        if (section.requires === "admin") return isAdmin;
        if (section.requires === "authenticated") return isAuthenticated;
        return true;
      })
      .map((section) =>
        section.id === "tools" && section.children
          ? {
              ...section,
              children: applyOrder(
                section.children,
                layout.menu.toolOrder,
                (child) => child.id,
              ),
            }
          : section,
      ),
);
