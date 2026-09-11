/**
 * The glyph beside a saved page, derived from its path.
 *
 * WHY DERIVED RATHER THAN STORED. A bookmark's icon is a fact about the
 * DESTINATION, not about the reader's copy of it. Deriving it means a page
 * saved a year ago picks up whatever icon the navigation uses for that tool
 * today, and adding a new tool needs one line here rather than a backfill.
 * That is also why `user_bookmarks` has no icon column (migration 0279).
 *
 * The tokens are the same ones the navigation rail uses
 * (components/app-shell/nav-icons.ts), so a bookmark to League Pulse carries
 * the League Pulse icon and the two surfaces cannot drift.
 *
 * LONGEST PREFIX WINS. "/tools/faab" is the calculator, "/tools" on its own is
 * the toolbox. The table is ordered for reading, not for matching: the lookup
 * sorts by length, so entries can go wherever they read best.
 *
 * Pure and client-safe: no imports beyond the icon-name type, so the bar, the
 * mobile sheet and the manage page all share one answer.
 */

import type { NavIconName } from "@/components/app-shell/nav-icons";

/**
 * Path prefix to icon token. A prefix matches the path itself or anything
 * below it, so "/brief" covers every Brief story.
 */
const PREFIX_ICONS: Record<string, NavIconName> = {
  "/about": "info",
  "/admin": "shield",
  "/brief": "newspaper",
  "/games": "gamepad",
  "/games/signal-scout": "radar",
  "/games/would-you-rather": "scale",
  "/guides": "book",
  // A LEAGUE IS NOT THE TOOL. `/leagues/...` used to take the League Pulse
  // glyph, which made the tool page and every league in it look identical on a
  // bar where the icon is most of what a reader scans. It gets the same plain
  // shield the league lists use as their placeholder, and a league that has a
  // logo of its own paints that instead (see lib/bookmarks/load.ts).
  "/leagues": "league",
  "/my-beacon": "userCircle",
  "/my-beacon/account": "settings",
  "/my-beacon/bookmarks": "bookmark",
  "/my-beacon/draft-tracker": "listChecks",
  "/my-beacon/profile": "badgeCheck",
  "/my-beacon/rankings": "layers",
  "/my-beacon/signal": "signal",
  "/my-beacon/sleeper-leagues": "users",
  "/players": "user",
  "/rankings": "listOrdered",
  "/tools": "wrench",
  "/tools/faab": "calculator",
  "/tools/league-pulse": "workflow",
  "/tools/manager-pulse": "users",
  "/tools/on-the-clock": "timer",
  "/tools/trade-calculator": "scale",
  "/tools/who-should-i-start": "swords",
  "/u": "badgeCheck",
};

/** Prefixes longest-first, computed once, so the lookup is a plain scan. */
const ORDERED_PREFIXES = Object.keys(PREFIX_ICONS).sort(
  (a, b) => b.length - a.length,
);

/**
 * The icon token for a bookmarked path. Falls back to the bookmark glyph, which
 * is honest about what it is: a page we have nothing more specific to say about.
 */
export function bookmarkIconFor(path: string): NavIconName {
  const clean = path.split("?")[0].split("#")[0];
  if (clean === "/" || clean === "") return "home";
  for (const prefix of ORDERED_PREFIXES) {
    if (clean === prefix || clean.startsWith(`${prefix}/`)) {
      return PREFIX_ICONS[prefix];
    }
  }
  return "bookmark";
}
