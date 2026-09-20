/**
 * Does this room pay over the odds, and which manager in it is the spender?
 *
 * Two numbers, both measured against the wider market rather than against each
 * other, because "this league bids high" only means anything next to what
 * everyone else pays for the same kind of add.
 *
 *   HEAT is the league's own price level. One number per league. A heat of 1.4
 *   says a contested add here goes for about 40% more than the same situation
 *   costs across every league we hold.
 *
 *   TENDENCY is one manager's habit, measured RELATIVE TO THEIR OWN ROOM. That
 *   is the whole point: in a league where everybody overpays, everybody would
 *   otherwise read as a big spender, and the table would tell a reader nothing
 *   about who to actually worry about.
 *
 * Both are shrunk toward 1 by sample size, so a manager with two bids does not
 * get a personality. Both are clamped, because one 100% bid on a quarterback
 * after an injury is a story about that week, not about the manager.
 *
 * Logs, not ratios, for the averaging: paying double and paying half are the
 * same size of deviation in opposite directions, and a plain mean of ratios
 * would call that pair 1.25 rather than 1.
 *
 * Pure.
 */

import type { AuctionSettings } from "./types";

/** One historical auction, with the market's own price for that situation. */
export type TendencyAuction = {
  week: number;
  /** Winning bid as a share of the league's full budget, 0 to 100. */
  winningPct: number;
  /** Every bid in the auction, winner included, as shares of the full budget. */
  bids: Array<{ rosterId: number; pct: number }>;
  /** The market median for this auction's situation, as a share of budget. */
  referencePct: number;
};

export type TendencyLabel = "Spends big" | "Typical" | "Holds money" | "Not enough history";

export type LeagueTendencies = {
  /** The league's price level against the wider market. 1 is average. */
  heat: number;
  /** Contested auctions the heat is measured over. */
  heatSamples: number;
  /** Per roster, relative to heat. 1 is a typical manager in this room. */
  tendencyByRoster: Map<number, number>;
  /** Bids counted per roster, so the table can say when it does not know. */
  bidsByRoster: Map<number, number>;
};

/**
 * The floor under both sides of the ratio.
 *
 * Half a percent of budget. Without it a $0 winning bid against a $0 reference
 * is 0/0, and a $1 win against a $0 reference is infinite heat. Half a percent
 * is below the smallest bid anyone makes in a $100 league and still a real
 * number in a $1,000 one.
 */
const FLOOR_PCT = 0.5;

function clampTo(value: number, [min, max]: [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

function logRatio(amountPct: number, referencePct: number): number {
  return Math.log(Math.max(amountPct, FLOOR_PCT) / Math.max(referencePct, FLOOR_PCT));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Shrink a mean toward zero by sample size: n / (n + k). */
function shrink(values: number[], k: number): number {
  const n = values.length;
  if (n === 0) return 0;
  return (n / (n + Math.max(0, k))) * mean(values);
}

export function computeLeagueTendencies(
  auctions: TendencyAuction[],
  settings: AuctionSettings,
): LeagueTendencies {
  // Week 1 is excluded by default. Budgets are full, half the room bids on
  // everything, and counting it would make every league look hot. Auctions
  // nobody contested say nothing about price either: the winner paid what they
  // felt like, which is usually nothing.
  const counted = auctions.filter(
    (a) => a.week >= settings.minContestedWeek && a.bids.length >= 2,
  );

  const heatRatios = counted.map((a) => logRatio(a.winningPct, a.referencePct));
  const heat = clampTo(Math.exp(shrink(heatRatios, settings.heatShrink)), settings.heatClamp);

  // A manager is measured against THIS ROOM'S OWN LEVEL, as a deviation from
  // the mean log bid of every bid in it, and only the deviation is shrunk.
  //
  // Dividing a shrunk manager figure by the shrunk heat looks equivalent and
  // is not: the two are shrunk by different constants (8 bids against 20
  // auctions), so in a league where every manager bids identically the two
  // corrections did not cancel and everybody came out at 1.12. Shrinking the
  // deviation instead makes "bids exactly like the room" land on exactly 1 at
  // any sample size, which is the only value that sentence can honestly have.
  const perRoster = new Map<number, number[]>();
  const allBidRatios: number[] = [];
  for (const auction of counted) {
    for (const bid of auction.bids) {
      const ratio = logRatio(bid.pct, auction.referencePct);
      allBidRatios.push(ratio);
      const list = perRoster.get(bid.rosterId) ?? [];
      list.push(ratio);
      perRoster.set(bid.rosterId, list);
    }
  }
  const roomLevel = mean(allBidRatios);

  const tendencyByRoster = new Map<number, number>();
  const bidsByRoster = new Map<number, number>();
  for (const [rosterId, ratios] of perRoster) {
    const deviations = ratios.map((r) => r - roomLevel);
    const own = Math.exp(shrink(deviations, settings.tendencyShrink));
    tendencyByRoster.set(rosterId, clampTo(own, settings.tendencyClamp));
    bidsByRoster.set(rosterId, ratios.length);
  }

  return { heat, heatSamples: counted.length, tendencyByRoster, bidsByRoster };
}

/** What one rival gets called in the table. */
export function tendencyLabel(
  tendencies: LeagueTendencies,
  rosterId: number,
  minBids = 3,
): TendencyLabel {
  const bids = tendencies.bidsByRoster.get(rosterId) ?? 0;
  if (bids < minBids) return "Not enough history";
  const value = tendencies.tendencyByRoster.get(rosterId) ?? 1;
  if (value >= 1.25) return "Spends big";
  if (value <= 0.8) return "Holds money";
  return "Typical";
}

/** A roster we have never seen bid behaves like everyone else. */
export function tendencyFor(tendencies: LeagueTendencies, rosterId: number): number {
  return tendencies.tendencyByRoster.get(rosterId) ?? 1;
}
