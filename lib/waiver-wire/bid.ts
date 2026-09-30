/**
 * What the board recommends bidding, and what it is allowed to claim.
 *
 * WHY THIS NO LONGER RUNS THE OLD RANK CURVE. The first version priced every
 * row through `lib/faab/calculate-faab.ts calculateFaabRecommendation`, the
 * calculator's original rank-and-value model. That model reads a band off the
 * player's overall VALUE rank, and a waiver player is by definition a long way
 * down any value ranking, so nearly every row landed in its deep-flyer band and
 * printed "0 to 2". Measured against the leagues we sync, that was wrong by an
 * order of magnitude on exactly the players the page exists for: in week 3 of
 * 2026 the most-claimed running back cleared at a median of 46 percent of
 * budget across 43 leagues, with four teams bidding on average. The calculator
 * itself stopped using that curve for anything but a last-resort fallback when
 * it moved to the market cells; the board had simply never followed it.
 *
 * WHAT IT DOES NOW. It answers "what does it take to win him", from two
 * measured sources, in this order of trust:
 *
 *   1. HIS OWN RECENT AUCTIONS. `waiver_claim_market()` (migration 0331)
 *      summarizes every auction he was won in across the synced leagues over
 *      the latest waiver runs: how many teams bid, and the winning share of
 *      budget at each quantile. When a player has been claimed in a dozen
 *      leagues, that IS his price.
 *   2. THE MARKET FOR PLAYERS LIKE HIM. The same `faab_market_priors` cells the
 *      FAAB calculator reads in manual mode, through the same `pickCell`
 *      fallback ladder and the same `priorCdf` win curve, keyed on the board's
 *      league type, lineup, his position, the time of season and an estimated
 *      number of rival bidders.
 *
 * The two are blended by how many of his own auctions we hold, so a player
 * claimed twice leans on the market and one claimed forty times leans on
 * himself. Both are expressed as the SAME two targets the calculator uses: the
 * value bid wins about 60 percent of the time and the make-sure bid about 90
 * (`settings.goal`), so "12 to 25 percent" here and the calculator's two
 * numbers answer the same pair of questions.
 *
 * WHAT IT CANNOT KNOW, STATED RATHER THAN PAPERED OVER. What he is WORTH to a
 * roster depends on that roster, and a public page has none. The calculator
 * caps a bid at that worth; this page cannot, so it says what the market
 * charges and tells the reader, beside every number, to pay it only if he
 * starts for them. That is the honest split between an article and a tool.
 *
 * PERCENTAGES, NEVER DOLLARS. See `BoardBid` in ./types.ts.
 *
 * Pure: takes settings, cells and plain numbers, returns plain numbers.
 */

import { bidForTargetFromCell, pickCell, type PriorCell } from "@/lib/faab/priors-math";
import { standardPhase, type PriorLeagueKind } from "@/lib/faab/priors-build";
import type { FaabSettings } from "@/lib/faab/types";
import type { BidderKey, BoardBid, BoardPosition, ClaimMarket } from "./types";

/**
 * The league the board measures replacement level in, in one place.
 *
 * Twelve teams and nine offensive starters is the most common Sleeper
 * configuration and the one the calculator's own defaults assume. It decides
 * the "over replacement" figure and feeds the demand estimate below. It no
 * longer carries a budget: the bids are shares of whatever budget a league has.
 */
export const STANDARD_LEAGUE = {
  teams: 12,
  offensiveStarters: 9,
} as const;

/**
 * Where a player has to sit before we stop calling him available.
 *
 * Not 100. A player rostered everywhere is not a waiver claim, and a board that
 * listed him would be a ranking page with the wrong title. Not 20 either: a
 * player rostered in half the leagues is genuinely free in the other half, and
 * those readers are the ones a waiver page is for. Seventy is where the list
 * stops being about the wire.
 */
export const AVAILABILITY_CEILING_PCT = 70;

/**
 * How many of his own auctions it takes before they carry half the weight.
 *
 * Six: below that a single league that got into a bidding war moves the median
 * further than it should, and above it the player's own price is a better read
 * than any market for "players like him".
 */
const OWN_AUCTIONS_HALF_WEIGHT = 6;

/** Fewer own auctions than this and they are ignored entirely. */
const MIN_OWN_AUCTIONS = 2;

/** Weight at or above which the row says its price came from his own claims. */
const CLAIMS_BASIS_WEIGHT = 0.6;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** The market cells' league kind for a format's league type. Keeper prices as redraft. */
export function priorLeagueKind(leagueType: string | null | undefined): PriorLeagueKind {
  return leagueType === "dynasty" ? "dynasty" : "redraft";
}

/** "dynasty superflex", "redraft one-quarterback", for the method notes. */
export function marketNameFor(leagueKind: PriorLeagueKind, superflex: boolean): string {
  return `${leagueKind} ${superflex ? "superflex" : "one-quarterback"}`;
}

function biddersFromCount(avg: number): BidderKey {
  if (avg < 1.5) return "1";
  if (avg < 2.5) return "2";
  if (avg < 3.5) return "3";
  return "4p";
}

const BIDDER_ORDER: BidderKey[] = ["1", "2", "3", "4p"];

function bumpBidders(key: BidderKey, by: number): BidderKey {
  const i = BIDDER_ORDER.indexOf(key);
  return BIDDER_ORDER[clamp(i + by, 0, BIDDER_ORDER.length - 1)];
}

/**
 * How many teams are likely to want him, when we have none of his own
 * auctions to count.
 *
 * Three signals a stranger's league would show too, weighted by how directly
 * they predict a crowd:
 *
 *   - How close he projects to a startable player at his position. The gap to
 *     replacement is what makes managers bid at all, and it is the calculator's
 *     own driver of competition (`biddersFor` in app/tools/faab/manual-setup.ts
 *     reads it off the same upgrade).
 *   - Whether his role just grew. A jump in touches is what the whole room sees
 *     in the box score on Monday.
 *   - How widely he is already gone. A player rostered in 55 percent of leagues
 *     is one the other 45 percent are about to fight over.
 *
 * Kickers and defenses are capped at two bidders: they are streamed, and the
 * measured cells say nobody fights over them.
 */
export function estimateBidders(params: {
  position: BoardPosition;
  pointsAboveReplacement: number | null;
  touchDelta: number | null;
  rosterPct: number | null;
  superflex: boolean;
  market: ClaimMarket | null;
}): BidderKey {
  const { market } = params;
  if (market && market.auctions >= 3) {
    return biddersFromCount(market.avgBidders);
  }

  const streamer = params.position === "K" || params.position === "DEF";
  const par = params.pointsAboveReplacement;
  const closeness =
    par == null ? 0 : streamer ? clamp((par + 2) / 4, 0, 1) : clamp((par + 6) / 9, 0, 1);
  const role = params.touchDelta == null ? 0 : clamp(params.touchDelta / 8, 0, 1);
  const gone = params.rosterPct == null ? 0 : clamp(params.rosterPct / AVAILABILITY_CEILING_PCT, 0, 1);
  const demand = 0.45 * closeness + 0.3 * role + 0.25 * gone;

  let key: BidderKey =
    demand >= 0.65 ? "4p" : demand >= 0.45 ? "3" : demand >= 0.25 ? "2" : "1";
  // A second starting quarterback is the one slot nobody can stream around.
  if (params.superflex && params.position === "QB") key = bumpBidders(key, 1);
  if (streamer && BIDDER_ORDER.indexOf(key) > 1) key = "2";
  return key;
}

/**
 * The share of budget at quantile `q` of his own winning bids.
 *
 * Linear between the four published quantiles, flat beyond the ends. The low
 * end is anchored at p25 rather than invented below it.
 */
export function ownQuantile(market: ClaimMarket, q: number): number {
  const points: Array<[number, number]> = [
    [0.25, market.p25],
    [0.5, market.p50],
    [0.75, market.p75],
    [0.9, market.p90],
  ];
  if (q <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [x, y] = points[i];
    const [px, py] = points[i - 1];
    if (q <= x) return py + ((y - py) * (q - px)) / (x - px);
  }
  return points[points.length - 1][1];
}

function tierFor(highPct: number): { tier: BoardBid["tier"]; tierLabel: string } {
  if (highPct <= 2) return { tier: "free", tierLabel: "Free claim" };
  if (highPct < 10) return { tier: "cheap", tierLabel: "Cheap add" };
  if (highPct < 25) return { tier: "real", tierLabel: "Real bid" };
  return { tier: "priority", tierLabel: "Priority add" };
}

/**
 * Price one claim, as two shares of the season budget.
 *
 * Returns null only when there is nothing measured to price from: no market
 * cells at all and none of his own auctions. The card then says so rather
 * than printing a zero.
 */
export function boardBid(params: {
  position: BoardPosition;
  leagueKind: PriorLeagueKind;
  superflex: boolean;
  week: number;
  pointsAboveReplacement: number | null;
  touchDelta: number | null;
  rosterPct: number | null;
  market: ClaimMarket | null;
  cells: PriorCell[];
  settings: FaabSettings;
}): BoardBid | null {
  const { settings } = params;
  const bidders = estimateBidders(params);

  const picked = pickCell(
    params.cells,
    {
      leagueKind: params.leagueKind,
      superflex: params.superflex,
      position: params.position,
      phase: standardPhase(params.week),
      bidders,
    },
    settings.priors.minCellSamples,
  );

  // The market read, in the calculator's own terms: the cheapest whole share
  // of a 100-unit budget whose chance of winning reaches each goal.
  const marketLow = picked
    ? bidForTargetFromCell(picked.cell, settings.goal.valueTarget, 100, 100)
    : null;
  const marketHigh = picked
    ? bidForTargetFromCell(picked.cell, settings.goal.sureTarget, 100, 100)
    : null;

  const own =
    params.market && params.market.auctions >= MIN_OWN_AUCTIONS ? params.market : null;
  const ownLow = own ? ownQuantile(own, settings.goal.valueTarget) : null;
  const ownHigh = own ? ownQuantile(own, settings.goal.sureTarget) : null;

  if (marketLow == null && ownLow == null) return null;

  let low: number;
  let high: number;
  let basis: BoardBid["basis"];
  if (own && ownLow != null && ownHigh != null) {
    const w = own.auctions / (own.auctions + OWN_AUCTIONS_HALF_WEIGHT);
    low = marketLow == null ? ownLow : w * ownLow + (1 - w) * marketLow;
    high = marketHigh == null ? ownHigh : w * ownHigh + (1 - w) * marketHigh;
    basis = marketLow == null || w >= CLAIMS_BASIS_WEIGHT ? "claims" : "blended";
  } else {
    low = marketLow ?? 0;
    high = marketHigh ?? low;
    basis = "market";
  }

  const lowPct = Math.round(clamp(low, 0, 100));
  const highPct = Math.max(lowPct, Math.round(clamp(high, 0, 100)));

  return { lowPct, highPct, bidders, basis, ...tierFor(highPct) };
}

/**
 * The last startable player at a position, in a league of this size.
 *
 * Walks the position's projections high to low and reads the one sitting where
 * the league runs out of starting spots. Everything above him is an upgrade
 * over what a manager can already field; everything below him is a bench
 * player with a good week, which is a different purchase.
 *
 * The starter counts come from the same admin-edited
 * `settings.manualReplacement` block the calculator's no-league mode uses, so
 * the two agree about where replacement level is by construction.
 *
 * Returns null when the position has fewer projected players than the league
 * needs starters, which happens for kickers and defenses in a week with byes.
 * Null is the right answer there: we cannot say what the last startable one
 * scores if we cannot see him.
 */
export function replacementPoints(
  sortedDescending: number[],
  replacementRank: number | null,
): number | null {
  if (replacementRank == null || replacementRank < 1) return null;
  if (sortedDescending.length === 0) return null;
  const index = Math.min(replacementRank - 1, sortedDescending.length - 1);
  const value = sortedDescending[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
