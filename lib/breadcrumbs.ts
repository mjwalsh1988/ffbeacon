/**
 * Breadcrumbs for every route on the site, derived from the pathname.
 *
 * The bar that shows these sits in the app shell, above every page, so a
 * per-page breadcrumb prop would mean touching ninety pages and would still
 * drift the first time someone added a route. Instead the trail is computed
 * from the URL: known path prefixes get a written label from ROUTE_LABELS, and
 * anything left over (a player slug, an article slug, a Sleeper league id) is
 * turned back into words by `humanizeSegment`.
 *
 * Pages that already know a better label than the slug can pass one in through
 * the shell's `crumbLabel` prop, which replaces the final crumb. That is the
 * only override, and it exists because "Ja'Marr Chase" reads better than
 * "Ja Marr Chase".
 *
 * The home node is the FF Beacon logo and is rendered by the bar itself, so
 * the trail returned here never includes it.
 */

/** One node in the trail. The last node is the current page and is not a link. */
export type Crumb = { label: string; href?: string };

/**
 * Written labels for path prefixes we know about. Keyed by the full path so a
 * segment can read differently depending on where it appears ("player" under
 * /brief is a filter, not a profile).
 */
const ROUTE_LABELS: Record<string, string> = {
  "/about": "About",
  "/admin": "Admin",
  "/author": "Authors",
  "/author/michael": "Michael",
  "/brief": "The Beacon Brief",
  "/brief/category": "Categories",
  "/brief/player": "Players",
  "/brief/tag": "Tags",
  "/brief/team": "Teams",
  "/games": "Games",
  "/games/signal-scout": "Signal Scout",
  "/guides": "Guides",
  "/guides/fantasy-football-terms": "Fantasy Football Terms",
  "/guides/fantasy-football-draft-guide": "Draft Guide",
  "/join": "Join the Discord",
  "/login": "Sign in",
  "/my-beacon": "My Beacon",
  "/my-beacon/account": "Account",
  "/my-beacon/draft-tracker": "Draft Tracker",
  "/my-beacon/draft-tracker/new": "Set up a draft",
  "/my-beacon/profile": "Profile",
  "/my-beacon/rankings": "Rankings Boards",
  "/my-beacon/signal": "Signal",
  "/my-beacon/signal/handle": "Handle",
  "/my-beacon/signal/identity": "Identity",
  "/my-beacon/signal/layout": "Layout",
  "/my-beacon/signal/showcase": "Showcase",
  "/my-beacon/signal/visibility": "Visibility",
  "/my-beacon/signal/wall": "Wall",
  "/my-beacon/sleeper-leagues": "Sleeper Leagues",
  "/players": "Players",
  "/privacy": "Privacy Policy",
  "/rankings": "Rankings",
  "/terms": "Terms of Service",
  "/tools": "Tools",
  "/tools/beacon-breakdown": "Beacon Breakdown",
  "/tools/faab": "FAAB Calculator",
  "/tools/league-pulse": "League Pulse",
  "/tools/on-the-clock": "On The Clock",
  "/tools/signal-check": "Signal Check",
  "/tools/signal-check/v": "Shared Verdict",
  "/u": "Profiles",
};

/**
 * Path prefixes that have no page of their own, so the crumb naming them is
 * plain text rather than a link. `/brief/category` lists nothing; only
 * `/brief/category/dynasty` does.
 */
const NON_NAVIGABLE = new Set([
  "/author",
  "/brief/category",
  "/brief/player",
  "/brief/tag",
  "/brief/team",
  "/players",
  "/tools/signal-check/v",
  "/u",
]);

/**
 * Route trees that draw their own breadcrumb inside their own chrome, so the
 * shared bar does not draw a second one. This is about the VISIBLE trail only:
 * League Pulse puts its crumbs next to the league action cluster and needs the
 * league's real name rather than its Sleeper id. It still wants the structured
 * data, which nothing under /leagues publishes, so the two decisions are
 * separate (see hasOwnBreadcrumbJsonLd).
 */
const SELF_MANAGED = ["/leagues/"];

/** Words that stay upper-case when a slug is turned back into a label. */
const ALL_CAPS = new Set([
  "ppr",
  "qb",
  "rb",
  "wr",
  "te",
  "faab",
  "adp",
  "nfl",
  "sf",
  "te p",
  "tep",
  "ir",
  "id",
]);

/**
 * A slug turned back into something readable: hyphens become spaces, each word
 * is capitalised, and the handful of abbreviations we care about stay shouted.
 * A segment that is all digits (a Sleeper league id, a season) is left alone.
 */
export function humanizeSegment(segment: string): string {
  const decoded = safeDecode(segment);
  if (/^\d+$/.test(decoded)) return decoded;
  return decoded
    .split("-")
    .filter(Boolean)
    .map((word) =>
      ALL_CAPS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** True when a route renders its own breadcrumb and the shared bar must not. */
export function hasOwnBreadcrumb(pathname: string): boolean {
  return SELF_MANAGED.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Route trees that already publish a BreadcrumbList of their own. The shared
 * bar still draws the trail on these pages; it just does not emit a second,
 * competing structured-data block.
 */
const OWN_JSON_LD = ["/brief", "/guides", "/players"];

export function hasOwnBreadcrumbJsonLd(pathname: string): boolean {
  return OWN_JSON_LD.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * The trail for one pathname, home excluded. The last crumb never carries an
 * href: it is the page you are on.
 */
export function buildBreadcrumbs(pathname: string): Crumb[] {
  const clean = pathname.split("?")[0].split("#")[0];
  if (clean === "/" || clean === "") return [];

  const segments = clean.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  let prefix = "";

  segments.forEach((segment, index) => {
    prefix += `/${segment}`;
    const isLast = index === segments.length - 1;
    const label = ROUTE_LABELS[prefix] ?? humanizeSegment(segment);
    crumbs.push({
      label,
      href: isLast || NON_NAVIGABLE.has(prefix) ? undefined : prefix,
    });
  });

  return crumbs;
}

/**
 * The same trail as JSON-LD, for search engines. Home is included here because
 * schema.org expects the full list starting at the site root, even though the
 * visible bar draws it as a logo.
 */
export function breadcrumbJsonLd(
  pathname: string,
  siteUrl: string,
): Record<string, unknown> | null {
  const crumbs = buildBreadcrumbs(pathname);
  if (crumbs.length === 0) return null;

  const base = siteUrl.replace(/\/$/, "");
  const items = [{ label: "Home", href: "/" }, ...crumbs].map((crumb, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: crumb.label,
    item: `${base}${crumb.href ?? pathname}`,
  }));

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}
