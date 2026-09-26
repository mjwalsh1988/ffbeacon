/**
 * Ordering helpers for the admin-edited site layout. Pure and client-safe: the
 * server applies a stored order with them and the admin form previews one.
 */

/**
 * Clean a stored order against the things that actually exist.
 *
 * Unknown entries are dropped (a tool that has since been removed), repeats keep
 * their first position, and anything the stored order does not mention (a tool
 * added after the row was saved) is appended in `known` order. The result is
 * always exactly `known`, rearranged, so a stale or damaged row can reorder the
 * menu but never lose an entry from it or invent one.
 */
export function normalizeOrder<T extends string>(
  stored: readonly unknown[] | null | undefined,
  known: readonly T[],
): T[] {
  const knownSet = new Set<string>(known);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of stored ?? []) {
    if (typeof entry !== "string" || !knownSet.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry as T);
  }
  for (const id of known) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

/** True when `list` holds every entry of `known` exactly once and nothing else. */
export function isPermutationOf(list: readonly string[], known: readonly string[]): boolean {
  if (list.length !== known.length) return false;
  const knownSet = new Set(known);
  const seen = new Set<string>();
  for (const entry of list) {
    if (!knownSet.has(entry) || seen.has(entry)) return false;
    seen.add(entry);
  }
  return true;
}

/**
 * `items` sorted into `order` by key. Anything the order does not name keeps
 * its original relative position, after everything it does name.
 */
export function applyOrder<T>(
  items: readonly T[],
  order: readonly string[],
  keyOf: (item: T) => string,
): T[] {
  const rank = new Map(order.map((key, i) => [key, i]));
  return items
    .map((item, i) => ({ item, rank: rank.get(keyOf(item)) ?? order.length + i }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.item);
}

/** One row of a packed grid, with how many of its columns are left empty. */
export type PackedRow<T> = { items: T[]; empty: number };

/**
 * How a CSS grid fills its rows when every item is auto-placed and the flow is
 * NOT dense, which is how the homepage tool grid is laid out.
 *
 * Items go in order. One that does not fit in what is left of the current row
 * starts the next row, and the columns it skipped stay empty: the placement
 * cursor never moves backwards to fill them. Dense packing would fill those
 * gaps by drawing cards out of order, which would put the visual order and the
 * reading and tab order out of step, so the homepage deliberately does not use
 * it and this preview does not pretend it does.
 *
 * A width wider than the grid is capped at the grid, matching the col-span
 * classes (a full-row card is two columns wide on a two-column grid).
 */
export function packRows<T>(
  items: readonly T[],
  widthOf: (item: T) => number,
  columns: number,
): PackedRow<T>[] {
  const rows: Array<{ items: T[]; used: number }> = [];
  let current: { items: T[]; used: number } | null = null;
  for (const item of items) {
    const span = Math.min(Math.max(1, Math.round(widthOf(item))), columns);
    if (!current || current.used + span > columns) {
      current = { items: [], used: 0 };
      rows.push(current);
    }
    current.items.push(item);
    current.used += span;
  }
  return rows.map((row) => ({ items: row.items, empty: columns - row.used }));
}

/**
 * The homepage grid a preview must model for a given column count: the tracks
 * it really has (six from `md`, so a half-row card is exact) and how many of
 * them a card of each width spans. Mirrors CARD_WIDTH_CLASSES in
 * components/tool-badge.tsx; the two must agree.
 */
export function gridTracks(columns: number): number {
  return columns >= 3 ? 6 : Math.max(1, columns);
}

export function cardSpan(width: number, columns: number): number {
  if (columns >= 3) return Math.round(width * 2);
  if (columns === 2) return width >= 2 ? 2 : 1;
  return 1;
}

/** Move one entry up or down a list. Returns the same array when it cannot move. */
export function moveEntry<T>(list: readonly T[], index: number, direction: "up" | "down"): T[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) {
    return list as T[];
  }
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
