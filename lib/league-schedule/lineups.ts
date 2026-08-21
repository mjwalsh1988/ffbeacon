/**
 * Reading the lineup a manager actually set, out of a stored league_matchups row.
 *
 * Two arrays have to stay in step for this to mean anything: Sleeper's
 * `starters` and its `starters_points`. Both are positional against the league's
 * startable slots (see lib/league-schedule/slots.ts), and an unfilled slot holds
 * the string "0" in one and a number in the other.
 *
 * Which copy of `starters` to read is the awkward part. lib/league-matchups.ts
 * used to write `starter_ids` through a filter that stripped the "0"
 * placeholders, which shifted every slot below an empty one up by a position.
 * That filter is gone, but rows written before it was removed are still in the
 * table holding the damaged array, and a `force` pulse is the only thing that
 * rewrites them. The undamaged copy has been there the whole time: `metadata`
 * stores the Sleeper matchup object verbatim, which is exactly the case the
 * CLAUDE.md metadata rule exists for. So we prefer `metadata.starters` and fall
 * back to the column.
 *
 * The points array follows whichever copy of the ids we picked. Pairing
 * `metadata.starters` with the `starter_points` column, or the reverse, would
 * reintroduce the same misalignment from the other side, on exactly the rows
 * this preference is meant to rescue.
 *
 * Nothing here throws on a length mismatch. Sleeper is the source and it does
 * not owe us an array the length of our slot list.
 */

import type { ScheduleSlot } from "./types";

/** The columns of a `league_matchups` row this module reads. All jsonb. */
export type RawMatchupRow = {
  /** Sleeper's `starters`, positional, "0" for an empty slot. */
  starter_ids: unknown;
  /** Sleeper's `starters_points`, aligned to `starter_ids`. */
  starter_points: unknown;
  player_ids: unknown;
  /** Sleeper's `players_points`, an object keyed by sleeper id. */
  player_points: unknown;
  /** The raw Sleeper matchup object. */
  metadata: unknown;
};

/** One slot of a set lineup, with whoever the manager put in it. */
export type SetLineupEntry = {
  slot: ScheduleSlot;
  /** Null for an empty slot, a "0" placeholder, or anything that is not a string. */
  sleeperId: string | null;
  /** What the slot scored. Null when unknown, never coerced to zero. */
  actualPoints: number | null;
};

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** A real Sleeper id, or null. "0" is the empty-slot placeholder, not a player. */
function asPlayerId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value === "0") return null;
  return value;
}

function asFinite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The starters array we trust, plus the points array that belongs with it.
 * Exported behaviour lives in `readSetLineup` and `rawStarterIds`; this is the
 * one place that decides which copy wins.
 */
function pickStarterArrays(row: RawMatchupRow): { ids: unknown[]; points: unknown[] } {
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;

  const metaIds = meta ? asArray(meta.starters) : null;
  if (metaIds) {
    return { ids: metaIds, points: asArray(meta?.starters_points) ?? [] };
  }
  return { ids: asArray(row.starter_ids) ?? [], points: asArray(row.starter_points) ?? [] };
}

/**
 * Pair the set lineup with the league's slots.
 *
 * Exactly one entry per slot, in slot order. A short starters array leaves the
 * tail empty; a long one has its excess ignored. Both happen in the wild when a
 * league changes its roster shape mid-season.
 */
export function readSetLineup(row: RawMatchupRow, slots: ScheduleSlot[]): SetLineupEntry[] {
  const { ids, points } = pickStarterArrays(row);
  return slots.map((slot, i) => ({
    slot,
    sleeperId: asPlayerId(ids[i]),
    actualPoints: asFinite(points[i]),
  }));
}

/**
 * Every rostered player's actual points for the week, keyed by sleeper id.
 * Sleeper sends this as an object, and it covers the bench too, which is what
 * lets a final week say how many points a manager left there.
 */
export function readRosteredPlayerPoints(row: RawMatchupRow): Map<string, number> {
  const out = new Map<string, number>();
  const raw = row.player_points;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [sleeperId, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = asPlayerId(sleeperId);
    if (id === null) continue;
    const points = asFinite(value);
    if (points === null) continue;
    out.set(id, points);
  }
  return out;
}

/**
 * The starters array as stored, placeholders intact and length preserved. For
 * callers that need to check alignment against the slot list rather than read
 * players out of it. Non-strings come back as "" so the length still matches.
 */
export function rawStarterIds(row: RawMatchupRow): string[] {
  const { ids } = pickStarterArrays(row);
  return ids.map((id) => (typeof id === "string" ? id : ""));
}
