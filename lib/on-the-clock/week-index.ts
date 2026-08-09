/**
 * Week lookup for a player projection, without the linear scan.
 *
 * Every engine that reads the projection board walks it week by week and asks
 * one player for one week at a time: the marginal engine does it once per
 * (candidate position, week) probe, Draft Pulse does it once per roster player
 * per week. Each of those was a `weeks.find()` over an eighteen-entry array, so
 * a full request spent a few hundred thousand comparisons re-deriving the same
 * mapping.
 *
 * The index is keyed by the projection OBJECT in a WeakMap, so it is built once
 * per player per board and released with the board. Nothing has to remember to
 * invalidate it: a rebuilt board is new objects, and new objects get new
 * indexes.
 *
 * Pure and browser-safe on purpose. The types come from projection-board.ts,
 * which is server-only, but types erase; this module holds no server code so it
 * cannot drag that import into a client bundle.
 */

import type { PlayerProjection, ProjectedWeekLite } from "./projection-board";

const indexes = new WeakMap<PlayerProjection, Map<number, ProjectedWeekLite>>();

/** One player's projected week, or undefined for a bye or an unpublished week. */
export function weekFor(
  projection: PlayerProjection,
  week: number,
): ProjectedWeekLite | undefined {
  let index = indexes.get(projection);
  if (!index) {
    index = new Map();
    // First entry wins, matching the `weeks.find()` this replaced. The board
    // builder sources weeks from a table keyed on (player_id, week), so a
    // duplicate should be impossible; behaving identically anyway means this can
    // never be the thing that changed an answer.
    for (const w of projection.weeks) if (!index.has(w.week)) index.set(w.week, w);
    indexes.set(projection, index);
  }
  return index.get(week);
}
