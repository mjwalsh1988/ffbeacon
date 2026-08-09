/**
 * Surplus value: what a pick was actually worth against what the market expected
 * at that slot.
 *
 * The drafting awards used to sum `pick_no - adp`, which has two problems. It
 * rewards teams for simply holding more picks, and it treats ten picks of ADP
 * surplus in round one as identical to ten picks in round fourteen. Landing
 * Ja'Marr Chase ten picks late is not the same event as landing the twelfth
 * tight end ten picks late, and any metric that says otherwise is measuring
 * draft position rather than drafting.
 *
 * So we measure in FF Beacon value. The market's own ordering (Sleeper ADP)
 * defines what each slot in the draft was worth: the player the market expected
 * first is worth what he is worth, the player it expected fortieth is worth what
 * HE is worth, and the curve between them is the price of a pick. A team's
 * surplus is the sum, over its picks, of what it got minus what that slot cost.
 *
 * Pure and deterministic.
 */

import type { RankedPlayer } from "./board-types";
import type { ShapedPick } from "./types";

/** A market price curve indexed by overall pick number. */
export interface MarketCurve {
  /** Value expected at each 1-based overall pick, ascending. */
  values: number[];
  /** How many players carried both an ADP and a value. */
  sample: number;
}

/**
 * Build the curve from the board. Every player with a Sleeper ADP and an FF
 * Beacon value is sorted by ADP, and their values in that order ARE the curve:
 * the market's first pick is worth values[0], its second values[1], and so on.
 *
 * The values are then made monotonically non-increasing. Left raw, a single
 * player the market is much higher on than we are puts a bump in the curve, and
 * a bump means the team drafting one slot later gets credited for the dip rather
 * than for anything they did.
 */
export function buildMarketCurve(board: RankedPlayer[]): MarketCurve {
  const priced = board
    .filter((p) => typeof p.adp === "number" && Number.isFinite(p.adp) && (p.adp as number) > 0)
    .sort((a, b) => (a.adp as number) - (b.adp as number));

  const values: number[] = [];
  let ceiling = Infinity;
  for (const p of priced) {
    const v = Math.min(ceiling, p.value);
    values.push(v);
    ceiling = v;
  }
  return { values, sample: priced.length };
}

/**
 * What the market says a given overall pick is worth. Picks past the end of the
 * curve are worth the last known value, which is the honest floor: nobody with
 * an ADP is expected there, so the slot is worth whatever the cheapest priced
 * player is. Returns null when there is no curve at all.
 */
export function marketValueAt(curve: MarketCurve, pickNo: number): number | null {
  if (curve.values.length === 0) return null;
  const index = Math.max(0, Math.min(curve.values.length - 1, Math.round(pickNo) - 1));
  return curve.values[index];
}

/** One pick's surplus, with everything the copy needs. */
export interface PickSurplus {
  pickNo: number;
  rosterId: number;
  playerId: string | null;
  playerName: string;
  position: string | null;
  /** FF Beacon value of the player taken. */
  value: number;
  /** What the market said that slot was worth. */
  marketValue: number;
  /** value minus marketValue. Positive is a bargain. */
  surplus: number;
}

export interface SurplusInput {
  picks: ShapedPick[];
  /** FF Beacon value by player id, from the board. */
  valueByPlayerId: Map<string, number>;
  /** Same, keyed by Sleeper id, for picks whose FF Beacon id never resolved. */
  valueBySleeperId: Map<string, number>;
  curve: MarketCurve;
}

/**
 * Per-pick surplus for every made, non-keeper pick we can value.
 *
 * Keepers are excluded because their slot is assigned rather than chosen: a
 * keeper at pick 3 is not a drafting decision and crediting it would reward the
 * league's rules rather than the drafter.
 */
export function computePickSurplus(input: SurplusInput): PickSurplus[] {
  const out: PickSurplus[] = [];
  for (const pick of input.picks) {
    if (pick.rosterId === null || pick.isKeeper) continue;
    const value =
      (pick.playerId ? input.valueByPlayerId.get(pick.playerId) : undefined) ??
      (pick.sleeperPlayerId ? input.valueBySleeperId.get(pick.sleeperPlayerId) : undefined);
    if (value === undefined) continue;
    const marketValue = marketValueAt(input.curve, pick.pickNo);
    if (marketValue === null) continue;
    out.push({
      pickNo: pick.pickNo,
      rosterId: pick.rosterId,
      playerId: pick.playerId,
      playerName: `${pick.firstName ?? ""} ${pick.lastName ?? ""}`.trim() || "Unknown player",
      position: pick.position,
      value,
      marketValue,
      surplus: value - marketValue,
    });
  }
  return out;
}

/** Totals per roster, plus the count so an average can be reported honestly. */
export function surplusByRoster(
  surpluses: PickSurplus[],
): Map<number, { total: number; count: number; average: number }> {
  const out = new Map<number, { total: number; count: number; average: number }>();
  for (const s of surpluses) {
    const entry = out.get(s.rosterId) ?? { total: 0, count: 0, average: 0 };
    entry.total += s.surplus;
    entry.count += 1;
    out.set(s.rosterId, entry);
  }
  for (const entry of out.values()) {
    entry.average = entry.count > 0 ? entry.total / entry.count : 0;
  }
  return out;
}
