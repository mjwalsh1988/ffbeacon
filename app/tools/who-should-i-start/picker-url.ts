/**
 * Pure URL-building for the start/sit picker's "Who should I start?" run
 * button and its no-JS form fallback.
 *
 * PURE. No React, no next/navigation. lib/start-sit/rank.ts clampStartCount
 * is the single source of truth for the 1..N-1 clamp; this module only joins
 * slugs in add order and carries the rest of the current query string along.
 */

import { clampStartCount } from "@/lib/start-sit/rank";

/**
 * Query params this module owns. Stripped from whatever is preserved so a
 * stale p, start, or the retired two-player a/b aliases never leak through
 * from a prior URL.
 */
const OWNED_PARAMS = ["p", "start", "a", "b"] as const;

export type BuildStartSitHrefOptions = {
  /**
   * The route to push to: "/tools/who-should-i-start" since the folder
   * move. A prop on the caller rather than a hardcoded literal so a future
   * move changes one string rather than every call site.
   */
  basePath: string;
  /** Player slugs, in add order. */
  slugs: string[];
  /** The reader's requested start count, clamped here to 1..slugs.length-1. */
  start: number;
  /**
   * Every other current query parameter (week, league, roster, format,
   * source, and anything else the page is holding), preserved verbatim. p,
   * start, and the retired a/b aliases are stripped even if present here.
   */
  preserve?: URLSearchParams | Record<string, string>;
};

/**
 * Builds "/tools/who-should-i-start?p=a,b&start=1&week=3" style hrefs.
 *
 * With no players, p and start are omitted entirely rather than written as
 * empty or zero: the bare basePath (plus whatever else was preserved) is the
 * correct href for an empty board.
 */
export function buildStartSitHref({
  basePath,
  slugs,
  start,
  preserve,
}: BuildStartSitHrefOptions): string {
  const params = new URLSearchParams(preserve ?? {});
  for (const key of OWNED_PARAMS) params.delete(key);

  if (slugs.length > 0) {
    params.set("p", slugs.join(","));
    params.set("start", String(clampStartCount(start, slugs.length)));
  }

  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
