/**
 * Canonical Signal Guide page registry + pathname matcher.
 *
 * This is the single source of truth for which user-facing pages can carry a
 * guide. The keys/titles mirror the seed rows in migration 0078; adding a page
 * means adding one entry here and one seed row (or an admin can add the row from
 * the manage UI later, but the matcher must know the key to surface it).
 *
 * The matcher maps a runtime `pathname` to a page_key. Order matters: entries are
 * tested most-specific-first so /leagues/x/teams/y resolves to 'league-team'
 * before /leagues/x would resolve to 'league-overview'. The single-segment
 * creator-profile catch-all is last and excludes real top-level routes so the
 * guide never mis-attaches to /login, /privacy, and the like.
 */

import { isReservedRouteSegment } from "@/lib/signal/reserved-routes";

export type GuidePageKey =
  | "home"
  | "rankings"
  | "tools"
  | "league-pulse"
  | "faab"
  | "guides"
  | "games"
  | "signal-scout"
  | "player-profile"
  | "league-overview"
  | "league-team"
  | "league-transactions"
  | "dashboard"
  | "my-rankings"
  | "my-signal"
  | "my-profile"
  | "sleeper-leagues"
  | "account"
  | "creator-profile"
  | "about"
  | "author";

export type GuidePageDef = {
  key: GuidePageKey;
  /** Display/admin name. Mirrors guide_pages.title at seed time. */
  title: string;
  /** Matches a normalized pathname (no trailing slash, no query). */
  match: (pathname: string) => boolean;
};

/** Strip a trailing slash (except the root) and any query/hash for matching. */
export function normalizePathname(pathname: string): string {
  let p = pathname.split("?")[0].split("#")[0];
  if (p.length > 1 && p.endsWith("/")) p = p.replace(/\/+$/, "");
  return p || "/";
}

const seg = (p: string) => p.split("/").filter(Boolean);

export const GUIDE_PAGES: GuidePageDef[] = [
  // League sub-routes before the league overview catch.
  {
    key: "league-team",
    title: "Team Roster",
    match: (p) => /^\/leagues\/[^/]+\/teams\/[^/]+$/.test(p),
  },
  {
    key: "league-transactions",
    title: "League Transactions",
    match: (p) => /^\/leagues\/[^/]+\/transactions$/.test(p),
  },
  {
    key: "league-overview",
    title: "League Overview",
    match: (p) => /^\/leagues\/[^/]+$/.test(p),
  },
  {
    key: "player-profile",
    title: "Player Profile",
    match: (p) => /^\/players\/[^/]+$/.test(p),
  },
  // Tools sub-routes before the tools hub.
  { key: "league-pulse", title: "League Pulse", match: (p) => p === "/tools/league-pulse" },
  { key: "faab", title: "FAAB Calculator", match: (p) => p === "/tools/faab" },
  { key: "tools", title: "Tools", match: (p) => p === "/tools" },
  { key: "rankings", title: "Rankings", match: (p) => p === "/rankings" },
  // Games sub-routes before the games hub.
  { key: "signal-scout", title: "Signal Scout", match: (p) => p === "/games/signal-scout" },
  { key: "games", title: "Games", match: (p) => p === "/games" },
  { key: "guides", title: "Guides", match: (p) => p === "/guides" || p.startsWith("/guides/") },
  // My Beacon sub-routes before the dashboard catch.
  { key: "account", title: "Account", match: (p) => p === "/my-beacon/account" },
  { key: "my-profile", title: "Edit Profile", match: (p) => p === "/my-beacon/profile" },
  {
    key: "sleeper-leagues",
    title: "My Sleeper Leagues",
    match: (p) => p === "/my-beacon/sleeper-leagues",
  },
  {
    // Intentionally covers both the boards index and an individual board
    // (/my-beacon/rankings/[boardId]) with one guide; the board detail shares the
    // same concepts as the index.
    key: "my-rankings",
    title: "My Rankings",
    match: (p) => p === "/my-beacon/rankings" || p.startsWith("/my-beacon/rankings/"),
  },
  {
    key: "my-signal",
    title: "My Signal Profile",
    match: (p) => p === "/my-beacon/signal" || p.startsWith("/my-beacon/signal/"),
  },
  { key: "dashboard", title: "My Beacon Dashboard", match: (p) => p === "/my-beacon" },
  { key: "about", title: "About", match: (p) => p === "/about" },
  { key: "author", title: "Author", match: (p) => p.startsWith("/author/") },
  { key: "home", title: "Home", match: (p) => p === "/" },
  // Public creator profile. Served at /{handle} (the alias) and at /u/{handle}
  // (the canonical path before the 301 to the alias), plus a handle ranking board
  // (/{handle}/rankings/{boardId}). Reserved top-level routes are excluded so a
  // guide never mis-attaches to a real page. A single unknown segment (e.g. a typo
  // that 404s) still resolves here, but that only triggers a cheap fetch that
  // returns an empty payload, so nothing renders.
  {
    key: "creator-profile",
    title: "Creator Profile",
    match: (p) => {
      const parts = seg(p);
      if (parts.length === 0) return false;
      // /u/{handle} canonical path (u is a reserved segment, handled explicitly).
      if (parts[0] === "u") return parts.length === 2;
      if (isReservedRouteSegment(parts[0])) return false;
      if (parts.length === 1) return true;
      return parts.length === 3 && parts[1] === "rankings";
    },
  },
];

/** Resolve a pathname to its guide page_key, or null when no page maps. */
export function resolveGuidePageKey(pathname: string): GuidePageKey | null {
  const p = normalizePathname(pathname);
  for (const def of GUIDE_PAGES) {
    if (def.match(p)) return def.key;
  }
  return null;
}

/** Human title for a guide page_key, falling back to the key itself when unknown. */
export function guidePageTitle(pageKey: string): string {
  return GUIDE_PAGES.find((d) => d.key === pageKey)?.title ?? pageKey;
}
