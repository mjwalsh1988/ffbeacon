/**
 * Pure metadata builders and query-param parsing for the Who Should I Start
 * board.
 *
 * PURE. No database, no React, no "server-only": everything here is a plain
 * function over plain strings so it can be unit tested without a server
 * render, matching the pattern lib/start-sit/rank.ts and
 * lib/start-sit/reasons.ts already set. Anything that needs a database read
 * (resolving a typed name to a slug, resolving the reader's format) lives in
 * page.tsx instead.
 *
 * Plan: docs/seo/who-should-i-start-and-site-seo-plan.md sections 2.3, 2.4
 * and 2.5.
 */

import { MIN_START_SIT_PLAYERS, MAX_START_SIT_PLAYERS } from "@/lib/start-sit/types";

/**
 * The one string the folder move (section 2.3, section 2.15's rollout order)
 * had to change. The route now lives under app/tools/who-should-i-start/;
 * this constant is what the canonical, every link on the page, and every
 * basePath prop read, so the move touched exactly one line here rather than
 * every call site. next.config.ts carries a permanent redirect from the old
 * /tools/beacon-breakdown path.
 */
export const TOOL_PATH = "/tools/who-should-i-start";

/**
 * Absolute title (bypasses the "%s | FF Beacon" template): 58 characters,
 * opens with the same six words as the H1 on purpose (section 2.4's own
 * reasoning: titles that match their H1 are rewritten far less often).
 */
export const START_SIT_TITLE =
  "Who Should I Start in Fantasy Football? | Beacon Breakdown";

/** The one visible H1, rendered server-side in BOTH the empty and loaded state. */
export const START_SIT_H1 =
  "Who Should I Start in Fantasy Football? The Beacon Breakdown Start/Sit Tool";

/**
 * The meta description, templated on the live week. 150 characters at
 * "Week 18", the longest case. `week` is always the LIVE week
 * (resolveSeasonClock's currentWeek), never the reader's selected ?week=: the
 * description is what a shared link previews as regardless of which week the
 * page happens to be showing when it is crawled.
 */
export function buildStartSitDescription(week: number): string {
  return `Who should I start this week? Put any players into Beacon Breakdown, the free start/sit tool, and get a Week ${week} verdict from projections and matchups.`;
}

/** Always the bare tool path. Never carries a query string: the comparison space is never canonical. */
export function buildStartSitCanonical(): string {
  return TOOL_PATH;
}

/** The raw query-param shape this page reads. Every value may arrive as an array (a repeated key). */
export type StartSitSearchParams = {
  p?: string | string[];
  a?: string | string[];
  b?: string | string[];
  start?: string | string[];
  week?: string | string[];
  league?: string | string[];
  roster?: string | string[];
  format?: string | string[];
  source?: string | string[];
  /** Retired from the URL (section 2.5): accepted so an old link does not 404, never read for anything. */
  lens?: string | string[];
};

/** The first value of a possibly-repeated query param, or undefined. */
export function firstParamValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The raw, not-yet-resolved list of ?p= entries (player slugs OR typed
 * names, in the reader's add order), applying the ?a=&b= alias.
 *
 * A request that carries ?p= ignores ?a=/?b= entirely: ?p= is the current
 * param, a&b is a compatibility alias for old shared links
 * (/tools/beacon-breakdown?a=x&b=y), never a second way to add a third
 * player. A request with only ONE of ?a=/?b= is treated as carrying no
 * players at all rather than guessing at a partial pair.
 *
 * Each entry is trimmed; blank entries (a stray comma, an empty a or b) are
 * dropped.
 *
 * THE LIST IS BOUNDED HERE, BEFORE ANY DATABASE WORK. Every entry that is not
 * a slug costs a player search, and this runs twice per request (metadata and
 * body) on an unauthenticated GET with no rate limit of its own, so an
 * unbounded ?p= of hundreds of tokens was hundreds of parallel queries per
 * page view. Entries are deduped case-insensitively, anything longer than
 * MAX_ENTRY_LENGTH (no real slug or name comes close) is dropped, and the
 * list is capped at MAX_START_SIT_PLAYERS. normalizeStartSitSlugs in
 * lib/start-sit/load.ts still dedupes again after names resolve to slugs.
 */
const MAX_ENTRY_LENGTH = 80;

function boundEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry || entry.length > MAX_ENTRY_LENGTH) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= MAX_START_SIT_PLAYERS) break;
  }
  return out;
}

export function parseRawPlayerEntries(params: StartSitSearchParams): string[] {
  const p = firstParamValue(params.p);
  if (p && p.trim().length > 0) {
    return boundEntries(p.split(","));
  }

  const a = firstParamValue(params.a);
  const b = firstParamValue(params.b);
  if (a && b) {
    return boundEntries([a, b]);
  }

  return [];
}

/** True once there are enough raw entries that a board is even worth attempting. Final feasibility (after slug resolution) is decided in page.tsx. */
export function hasEnoughRawEntries(entries: string[]): boolean {
  return entries.length >= MIN_START_SIT_PLAYERS;
}

/**
 * The query string for the share image (section 2.10):
 * ?p=&start=&week=&format=&source=, source being the VALUE source only,
 * never the projection source (which is not a reader choice). Player slugs
 * must already be resolved (real players.slug values, not typed names): the
 * OG route validates each one against a slug pattern and does not search by
 * name.
 */
export function buildStartSitOgImagePath({
  slugs,
  start,
  week,
  format,
  source,
}: {
  slugs: string[];
  start: number;
  week: number;
  format: string;
  source: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("p", slugs.join(","));
  params.set("start", String(start));
  params.set("week", String(week));
  params.set("format", format);
  if (source) params.set("source", source);
  return `/api/og/start-sit?${params.toString()}`;
}
