/**
 * The quick filter every league list shares.
 *
 * Pure and client-safe, and split out from the components so the matching rule
 * is one thing rather than one per list. A reader in fourteen leagues should
 * not have to scan fourteen rows to find the one they meant, and they should
 * not get a different answer on the FAAB picker than on the League Pulse table.
 *
 * The rule is deliberately forgiving rather than clever: case-insensitive,
 * whitespace-trimmed, and every whitespace-separated term has to appear
 * somewhere in the text. So "dyn room" finds "The Dynasty Room", and typing
 * the words in the wrong order still finds it. There is no fuzzy matching: a
 * filter that returns rows a reader cannot see the reason for is worse than
 * one that returns nothing, because the empty state at least tells the truth.
 */

import { CATEGORY_ORDER, type LeagueCategoryKey } from "@/lib/league-category";

/**
 * The type toggles that sit beside the text field.
 *
 * "All" plus one chip per bucket, and ONLY the buckets actually present in
 * the reader's own list: offering "Best Ball Dynasty" to somebody with no best
 * ball league is a control that can only ever empty the list.
 */
export type LeagueTypeFilter = LeagueCategoryKey | "all";

/** The buckets present in a list, in the site's own display order. */
export function presentLeagueCategories<T>(
  items: readonly T[],
  toKey: (item: T) => LeagueCategoryKey | null | undefined,
): LeagueCategoryKey[] {
  const seen = new Set<LeagueCategoryKey>();
  for (const item of items) {
    const key = toKey(item);
    if (key) seen.add(key);
  }
  return CATEGORY_ORDER.filter((c) => seen.has(c.key)).map((c) => c.key);
}

/**
 * Below two distinct buckets the toggles are noise: every chip either shows
 * everything or shows nothing, which is a control that cannot help.
 */
export const LEAGUE_TYPE_FILTER_MIN_TYPES = 2;

/** True when this league passes the selected type toggle. */
export function matchesLeagueType(
  key: LeagueCategoryKey | null | undefined,
  selected: LeagueTypeFilter,
): boolean {
  return selected === "all" || key === selected;
}

/** True when every term in `query` appears in `text`. An empty query matches. */
export function matchesLeagueQuery(text: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = text.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * Filter a list by a query over whatever text each item carries.
 *
 * `toText` gets everything a reader can SEE on the row, not just the name, so
 * a search for "2026" or for a team name lands where a reader expects. What a
 * row shows and what it can be found by should be the same thing.
 */
export function filterByLeagueQuery<T>(
  items: readonly T[],
  query: string,
  toText: (item: T) => string,
): T[] {
  if (!query.trim()) return [...items];
  return items.filter((item) => matchesLeagueQuery(toText(item), query));
}

/**
 * What the live region says after a filter runs.
 *
 * A filter that silently removes rows is a filter a screen reader user cannot
 * tell is working, so the count is announced. It names the total as well as
 * the match count, because "3 leagues" alone does not say whether the other
 * eleven were filtered out or never existed.
 */
export function describeLeagueFilter(
  matched: number,
  total: number,
  query: string,
  typeLabel?: string | null,
): string {
  const noun = total === 1 ? "league" : "leagues";
  // Both halves of the filter are named, because a reader who typed nothing
  // and pressed Dynasty needs to hear WHY eleven rows went away just as much
  // as one who typed "dyn".
  const clauses: string[] = [];
  if (query.trim()) clauses.push(`match "${query.trim()}"`);
  if (typeLabel) clauses.push(`are ${typeLabel}`);

  if (clauses.length === 0) return `${total} ${noun}.`;
  const tail = clauses.join(" and ");
  if (matched === 0) {
    return `No leagues ${tail}. Showing none of ${total}.`;
  }
  return `${matched} of ${total} ${noun} ${tail}.`;
}

/**
 * Below this many rows a filter is clutter: a reader can see the whole list.
 *
 * Not zero, because an always-present search box on a three-league list is one
 * more thing to tab past on the way to the leagues themselves, which is the
 * problem this whole change set is about.
 */
export const LEAGUE_FILTER_MIN_ROWS = 6;
