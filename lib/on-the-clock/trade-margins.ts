/**
 * Per-roster value margin across a league's completed in-draft trades.
 *
 * Both the Most Successful Trader award and the trades component of the draft
 * grade need the same number, and they were computing it separately inside
 * awards.ts. One copy, so an award and a grade can never disagree about who won
 * a deal.
 *
 * Valuation goes through trade-history.ts analyzeTradeTransaction, the same
 * board projection the Trade History tab renders, which is why a trade reads the
 * same on the tab, on the card, and in the grade.
 *
 * Pure and deterministic.
 */

import {
  analyzeTradeTransaction,
  type HistoryTransaction,
  type TradeHistoryContext,
} from "./trade-history";

export interface TradeMargin {
  /** Signed FF Beacon value received minus value given, summed over their trades. */
  total: number;
  /** How many trades they actually moved value in. */
  trades: number;
}

/**
 * One entry per roster that moved value. A roster that took part in a trade
 * without moving any valued asset is absent rather than recorded at zero,
 * because "traded and broke even" and "did not trade" are different facts.
 */
export function tradeMarginsFor(
  transactions: HistoryTransaction[],
  context: TradeHistoryContext | null,
): Map<number, TradeMargin> {
  const out = new Map<number, TradeMargin>();
  if (!context) return out;

  for (const txn of transactions) {
    const entry = analyzeTradeTransaction(txn, context);
    const received = new Map<number, number>();
    const given = new Map<number, number>();
    for (const side of entry.sides) {
      // Only rosters that actually moved value are recorded. A side that
      // received nothing valued did not trade value, and counting it at zero
      // would drag its average toward nothing for a deal it never made.
      if (side.total !== 0) {
        received.set(side.rosterId, (received.get(side.rosterId) ?? 0) + side.total);
      }
      for (const asset of side.assets) {
        if (asset.fromRosterId != null) {
          given.set(asset.fromRosterId, (given.get(asset.fromRosterId) ?? 0) + asset.value);
        }
      }
    }
    const involved = new Set<number>([...received.keys(), ...given.keys()]);
    for (const rosterId of involved) {
      const margin = (received.get(rosterId) ?? 0) - (given.get(rosterId) ?? 0);
      const current = out.get(rosterId) ?? { total: 0, trades: 0 };
      current.total += margin;
      current.trades += 1;
      out.set(rosterId, current);
    }
  }
  return out;
}
