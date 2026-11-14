/**
 * The value side of a trade, measured one way everywhere.
 *
 * Three surfaces used to print a "value percent" and each worked it out on its
 * own: the suggestion card divided the gap by the larger side, the builder's
 * call divided it by both sides together, and the transaction grades divided by
 * the larger side again with their own thresholds. One trade could read 12% on
 * one screen and 21% on the next. This module is the one definition, and it is
 * Signal Check's: |A - B| / (A + B).
 *
 * It also owns the consolidation step. A package of bench pieces does not buy a
 * starter just because the numbers add up, and Signal Check charges for that
 * with the balancing adjustment in lib/trade-quality.ts. The ranking and the
 * builder's call both read the adjusted totals from here, so a two-for-one is
 * priced the same on the card, in the call and in Signal Check.
 *
 * Unpriced assets (defenders, picks past the priced rounds) carry no value and
 * are left out of both totals. They are never counted as zero-value pieces in a
 * package either, which would charge a package discount for an asset nobody
 * priced.
 *
 * Pure.
 */

import {
  DEFAULT_TRADE_QUALITY_CONFIG,
  solveTradeBalance,
  type TradeQualityConfig,
} from "@/lib/trade-quality";

export type ValueQuality = {
  config: TradeQualityConfig;
  /** Top value in this format and source. Null falls back to the trade's own top. */
  poolMax: number | null;
};

/** Who comes out ahead on value. */
export type ValueFavors = "you" | "them" | "even";

/**
 * Margin under which the two sides are called even, as a percent of both sides
 * together. Signal Check's neutral threshold, so the two tools agree.
 */
export const EVEN_MARGIN_PCT = 3;

/** Margin at which one side is being run over. Also Signal Check's. */
export const LOPSIDED_MARGIN_PCT = 20;

/**
 * The value percent: the gap between the sides as a share of both together.
 * 0 is a dead heat and 100 is everything going one way. 0 when nothing is
 * priced on either side, because there is no gap to measure.
 */
export function valueMarginPct(valueIn: number, valueOut: number): number {
  const a = Number.isFinite(valueIn) && valueIn > 0 ? valueIn : 0;
  const b = Number.isFinite(valueOut) && valueOut > 0 ? valueOut : 0;
  const combined = a + b;
  if (combined <= 0) return 0;
  return (Math.abs(a - b) / combined) * 100;
}

/**
 * The same margin as a share of the LARGER side, for thresholds that were
 * tuned on that measure. A monotonic conversion, so a threshold converted with
 * it draws the line in exactly the same place.
 */
export function marginToLargerShare(marginPct: number): number {
  const m = Math.min(Math.max(marginPct / 100, 0), 1);
  return (2 * m) / (1 + m);
}

/** The inverse of marginToLargerShare, in percent. */
export function largerShareToMarginPct(share: number): number {
  const s = Math.min(Math.max(share, 0), 1);
  return (s / (2 - s)) * 100;
}

function priced(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v) && v > 0);
}

/**
 * Both sides after the consolidation adjustment, from the reader's side.
 *
 * `adjustment` is the balancing amount Signal Check would print as its "Value
 * adjustment" line, credited to whichever side holds the better single piece.
 * Zero for a one-for-one, a dead heat, or an adjustment under the noise floor.
 */
export function consolidatedTotals(
  incoming: number[],
  outgoing: number[],
  quality?: ValueQuality | null,
): { valueIn: number; valueOut: number; adjustment: number } {
  const a = priced(incoming);
  const b = priced(outgoing);
  const rawIn = a.reduce((s, v) => s + v, 0);
  const rawOut = b.reduce((s, v) => s + v, 0);
  if (a.length === 0 || b.length === 0) {
    return { valueIn: rawIn, valueOut: rawOut, adjustment: 0 };
  }
  const balance = solveTradeBalance(
    a,
    b,
    quality?.poolMax ?? null,
    quality?.config ?? DEFAULT_TRADE_QUALITY_CONFIG,
  );
  if (!balance.applied) return { valueIn: rawIn, valueOut: rawOut, adjustment: 0 };
  return {
    valueIn: balance.effective.a,
    valueOut: balance.effective.b,
    adjustment: balance.adjustment,
  };
}

/** Everything a surface needs to print the value half of a trade. */
export type ValueMargin = {
  valueIn: number;
  valueOut: number;
  /** Your share of both sides together, 0 to 100. 50 when nothing is priced. */
  yourShare: number;
  marginPct: number;
  favors: ValueFavors;
  lopsided: boolean;
};

/** The value margin of two totals, already adjusted or not. */
export function valueMarginOf(valueIn: number, valueOut: number): ValueMargin {
  const combined = Math.max(valueIn, 0) + Math.max(valueOut, 0);
  const marginPct = valueMarginPct(valueIn, valueOut);
  const yourShare = combined > 0 ? (Math.max(valueIn, 0) / combined) * 100 : 50;
  const favors: ValueFavors =
    combined === 0 || marginPct < EVEN_MARGIN_PCT
      ? "even"
      : valueIn > valueOut
        ? "you"
        : "them";
  return {
    valueIn,
    valueOut,
    yourShare,
    marginPct,
    favors,
    lopsided: marginPct >= LOPSIDED_MARGIN_PCT,
  };
}
