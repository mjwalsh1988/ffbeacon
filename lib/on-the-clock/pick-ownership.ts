/**
 * On The Clock draft-pick ownership model (Phase 6C.1).
 *
 * Pure, browser-safe, deterministic. NOTHING here touches Sleeper, Supabase, or
 * fetch. It turns the cached draft order (slot_to_roster_id), the made picks, and
 * Sleeper's traded_picks (the materialized result of every pick trade) into:
 *   - resolveCurrentDraftPicks: every pick in the current startup draft, with its
 *     original team, current owner (transaction-aware), made/upcoming flag, and the
 *     player selected when made.
 *   - resolveTradedFuturePicks: concrete FUTURE-season picks whose ownership has
 *     changed hands, so the UI can label "owned by Team X".
 *
 * Ownership rules:
 *   - A pick's ORIGINAL owner is the roster that drafts at its seat (slot_to_roster_id).
 *   - Its CURRENT owner is, in priority order: the roster that actually made the pick
 *     (authoritative once made), else the traded_picks owner for (season, round,
 *     original roster), else the original roster.
 *   - When the seat -> roster mapping is missing (cold/odd draft), ownership is left
 *     unknown rather than guessed; the pick stays usable.
 *
 * Serpentine seat/overall math reuses the existing draft-shape helpers so snake,
 * linear, and third-round-reversal drafts all map correctly.
 */

import type { ShapedPick } from "./types";
import { seatForPick, type DraftShape } from "./draft-derive";

/** A traded pick normalized from Sleeper's /league/{id}/traded_picks payload. */
export interface TradedPickRecord {
  season: number;
  round: number;
  /** The roster whose pick this originally was (the seat owner). */
  originalRosterId: number;
  /** The roster that currently owns the pick after all trades. */
  currentOwnerRosterId: number;
}

/** One pick in the current startup draft, with ownership + made/upcoming state. */
export interface CurrentDraftPick {
  overall: number;
  round: number;
  /** Position within the round (1..teams). */
  pickInRound: number;
  /** Draft seat (1..teams). */
  slot: number;
  originalRosterId: number | null;
  currentOwnerRosterId: number | null;
  /** False when we could not resolve any owner for the seat. */
  ownershipKnown: boolean;
  made: boolean;
  /** The actual pick row when made (player + roster that selected). */
  madePick: ShapedPick | null;
}

/** A concrete future-season pick whose ownership changed via a trade. */
export interface TradedFuturePick {
  season: number;
  round: number;
  originalRosterId: number;
  currentOwnerRosterId: number;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Defensively normalize the cached traded_picks jsonb (array of Sleeper records:
 * { season, round, roster_id, owner_id, previous_owner_id }). Skips rows missing
 * the fields we rely on. Never throws.
 */
export function normalizeTradedPicks(raw: unknown): TradedPickRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: TradedPickRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const season = toNum(o.season);
    const round = toNum(o.round);
    const originalRosterId = toNum(o.roster_id);
    const currentOwnerRosterId = toNum(o.owner_id);
    if (season === null || round === null || originalRosterId === null || currentOwnerRosterId === null) {
      continue;
    }
    out.push({ season, round, originalRosterId, currentOwnerRosterId });
  }
  return out;
}

function tradedKey(season: number, round: number, originalRosterId: number): string {
  return `${season}|${round}|${originalRosterId}`;
}

export interface CurrentPicksInput {
  teams: number;
  rounds: number;
  shape: DraftShape;
  /** slot (as string key) -> original roster id, from the Sleeper draft object. */
  slotToRosterId: Record<string, number>;
  madePicks: ShapedPick[];
  tradedPicks: TradedPickRecord[];
  /** The current draft's season (used to match traded_picks rows). */
  currentSeason: number;
}

/**
 * Build every pick in the current startup draft (round 1..rounds, all seats), in
 * overall order, with transaction-aware ownership and made/upcoming state. Returns
 * [] when teams/rounds are unknown.
 */
export function resolveCurrentDraftPicks(input: CurrentPicksInput): CurrentDraftPick[] {
  const { teams, rounds, shape, slotToRosterId, madePicks, tradedPicks, currentSeason } = input;
  if (teams <= 0 || rounds <= 0) return [];

  const madeByPickNo = new Map<number, ShapedPick>();
  for (const p of madePicks) madeByPickNo.set(p.pickNo, p);

  const tradedByKey = new Map<string, number>();
  for (const t of tradedPicks) {
    if (t.season === currentSeason) {
      tradedByKey.set(tradedKey(t.season, t.round, t.originalRosterId), t.currentOwnerRosterId);
    }
  }

  const out: CurrentDraftPick[] = [];
  const total = teams * rounds;
  for (let overall = 1; overall <= total; overall++) {
    const round = Math.ceil(overall / teams);
    const seat = seatForPick(overall, teams, shape);
    const pickInRound = ((overall - 1) % teams) + 1;
    const originalRosterId = slotToRosterId[String(seat)] ?? null;

    const made = madeByPickNo.get(overall) ?? null;

    let currentOwnerRosterId: number | null = originalRosterId;
    let ownershipKnown = originalRosterId !== null;
    if (made && made.rosterId != null) {
      // Authoritative: the roster that actually made the pick.
      currentOwnerRosterId = made.rosterId;
      ownershipKnown = true;
    } else if (originalRosterId !== null) {
      const traded = tradedByKey.get(tradedKey(currentSeason, round, originalRosterId));
      if (traded !== undefined) currentOwnerRosterId = traded;
    }

    out.push({
      overall,
      round,
      pickInRound,
      slot: seat,
      originalRosterId,
      currentOwnerRosterId,
      ownershipKnown,
      made: made !== null,
      madePick: made,
    });
  }
  return out;
}

/**
 * Concrete future-season (season > currentSeason) picks that have changed hands.
 * These let the UI label a specific traded future pick with its current owner,
 * separate from the generic Early/Mid/Late buckets.
 */
export function resolveTradedFuturePicks(
  tradedPicks: TradedPickRecord[],
  currentSeason: number,
): TradedFuturePick[] {
  return tradedPicks
    .filter((t) => t.season > currentSeason && t.currentOwnerRosterId !== t.originalRosterId)
    .map((t) => ({
      season: t.season,
      round: t.round,
      originalRosterId: t.originalRosterId,
      currentOwnerRosterId: t.currentOwnerRosterId,
    }))
    .sort((a, b) => a.season - b.season || a.round - b.round || a.currentOwnerRosterId - b.currentOwnerRosterId);
}
