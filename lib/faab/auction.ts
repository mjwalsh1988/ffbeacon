/**
 * What will it take to win him?
 *
 * The old calculator answered that with a multiplier on what the player was
 * worth to the reader, which is the one input that has nothing to do with the
 * price. Price is set by the other wallets in the room: our own 16,409
 * auctions say a claim with one bidder clears at nothing, two at 5% of budget,
 * three at 10.5%, four or more at 20%, and that the winner pays about twice
 * the runner-up. None of that moves when the reader's roster changes.
 *
 * So this simulates the rest of the league instead. Each rival decides whether
 * to bid, draws an amount around its own centre, and the highest rival bid is
 * the number the reader has to beat. Run it a few thousand times and the share
 * of runs a bid of b clears is the reader's chance of winning at b, which is
 * the one figure the tool was missing and no competitor publishes.
 *
 * TWO THINGS BEND A RIVAL'S BID AWAY FROM THEIR OWN VALUATION, in opposite
 * directions, and both are measured rather than assumed. `worthToBidRatio`
 * pulls it down, because FAAB is one budget for a whole season and nobody
 * spends their reservation price on an ordinary add. `scarcityPremiumPct`
 * pushes it up for a player who will not reach a wire again, because that is
 * what our own settled auctions show the room doing.
 *
 * SEEDED. The same league and the same player give the same curve every time.
 * A win chance that drifted by two points on a page refresh would be read as
 * the model changing its mind.
 *
 * Pure: no client, no clock, no I/O.
 */

import { createRng } from "@/lib/power-pulse/math";
import { priorCdf, type PriorCell } from "./priors-read";
import type { AuctionSettings } from "./types";

export type AuctionRival = {
  rosterId: number;
  /** Remaining budget as a share of the league's full budget, 0 to 100. */
  budgetPct: number;
  /** Would this player crack their starting lineup? */
  interested: boolean;
  /**
   * What he is WORTH to them, as a share of the full budget. Not what they
   * bid: `settings.worthToBidRatio` turns the one into the other, inside
   * `rivalBid`, so the discipline lives in one place and the league's measured
   * heat and this manager's own habit still multiply a calibrated base.
   */
  centerPct: number;
  /** Lower means earlier in the waiver order. Null when we do not know. */
  waiverPosition: number | null;
};

export type AuctionInput = {
  yourBudgetPct: number;
  yourWaiverPosition: number | null;
  rivals: AuctionRival[];
  /** The market cell a rival with no read of its own bids out of. */
  strayCell: PriorCell | null;
  settings: AuctionSettings;
  seed: number;
  /** The league's full budget in dollars, so bids land on the real grid. */
  totalBudget: number;
  /** The smallest bid this league accepts, in dollars. */
  minBid: number;
  /**
   * Chopped leagues only: several starters hit waivers at once, so a rival
   * chasing this player has somewhere else to spend. Scales participation.
   */
  participationScale?: number;
  /**
   * How close this player is to a genuine starter on the open market, 0 to 1,
   * where 1 is a player who does not normally reach a wire at all.
   *
   * Drives `settings.scarcityPremiumPct`. A rival's lineup arithmetic is the
   * right first answer to "what will they bid" and an incomplete one: when a
   * top-round player is available the room bids because he will not come round
   * again, not because of the 6 points he adds to their flex. Null when we hold
   * no market value for him, and then no premium is applied rather than a
   * guessed one.
   */
  scarcityShare?: number | null;
};

export type AuctionCurve = {
  /** Chance a bid of this many DOLLARS beats every rival. 0 to 1. */
  winChanceAt: (dollars: number) => number;
  /** The highest rival bid, in dollars. */
  rivalTop: { p50: number; p75: number; p90: number };
  /** Share of runs where nobody else bid at all. */
  noRivalShare: number;
  /** Rivals the simulation treated as interested. */
  interestedCount: number;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * A standard normal draw, Box-Muller.
 *
 * Deliberately NOT lib/power-pulse/math.ts normalDraw, which floors its result
 * at zero because a fantasy team cannot score negative points. Here the draw is
 * the exponent of a lognormal, so its negative half is what makes a rival bid
 * BELOW its centre. Flooring it would have made every rival in the league bid
 * high and quietly halved every reader's win chance.
 */
function standardNormal(rng: () => number): number {
  let u = rng();
  if (u <= 0) u = Number.EPSILON;
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Draw a price out of a market cell by inverting its distribution.
 *
 * A rival with no lineup reason to want the player still bids sometimes, and
 * what they bid looks like the market at large rather than like a valuation.
 * Bisection over priorCdf, which is monotone, so 24 steps put us within about
 * six thousandths of a percent of budget.
 */
function drawFromCell(cell: PriorCell, u: number): number {
  let low = 0;
  let high = 100;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (priorCdf(cell, mid) < u) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * One rival's bid in dollars, or null when they sit this one out.
 *
 * Rounding to whole dollars is not cosmetic. Ties are common in FAAB, every
 * platform breaks them by waiver order, and a model working in continuous
 * percentages would never produce one, which would quietly overstate the
 * reader's chances at exactly the round numbers people actually bid.
 */
function rivalBid(
  rival: AuctionRival,
  input: AuctionInput,
  rng: () => number,
): number | null {
  const { settings } = input;
  const scale = input.participationScale ?? 1;
  const chance = rival.interested
    ? clamp(settings.participation * scale, 0, 1)
    : clamp(settings.strayBidRate, 0, 1);
  if (rng() >= chance) return null;

  let pct: number;
  if (rival.interested) {
    // NOBODY BIDS WHAT A PLAYER IS WORTH TO THEM. FAAB is one budget for a
    // whole season, so a dollar spent here is a dollar not available for the
    // next injury, and a manager bidding their reservation price on every
    // claim is broke by week 6. Treating `centerPct` as the bid itself put
    // the simulated top rival at the p90 of every real auction we hold, which
    // is what made the reader's recommendation the whole budget on any player
    // two teams wanted.
    // The scarcity premium sits beside the discipline, and they pull opposite
    // ways on purpose: a rival bids well under their valuation on an ordinary
    // add, and well over their lineup arithmetic on a player who will not be
    // available again.
    const scarcity =
      input.scarcityShare == null
        ? 1
        : 1 + (Math.max(0, settings.scarcityPremiumPct) / 100) * clamp(input.scarcityShare, 0, 1);
    const centre = rival.centerPct * clamp(settings.worthToBidRatio, 0, 1) * scarcity;
    // Lognormal around the centre: a bid can be a multiple of the expected
    // price but never negative, which is how overbids actually look.
    pct = centre * Math.exp(settings.bidSigma * standardNormal(rng));
  } else if (input.strayCell) {
    pct = drawFromCell(input.strayCell, rng());
  } else {
    pct = 1;
  }

  const capped = clamp(pct, 0, Math.min(100, rival.budgetPct));
  const dollars = Math.round((capped / 100) * input.totalBudget);
  return Math.max(0, Math.min(dollars, Math.floor((rival.budgetPct / 100) * input.totalBudget)));
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(clamp(p, 0, 1) * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}

export function simulateAuction(input: AuctionInput): AuctionCurve {
  const { settings } = input;
  const runs = Math.max(1, Math.floor(settings.runs));
  const rng = createRng(input.seed >>> 0);

  // Per run: the highest rival bid, and the waiver position of whoever made it
  // (the best position among everyone tied at the top, because that is the
  // team the reader would actually have to outrank).
  const tops: number[] = [];
  const topPositions: Array<number | null> = [];
  let noRivalRuns = 0;

  for (let run = 0; run < runs; run += 1) {
    let top = -1;
    let topPosition: number | null = null;
    for (const rival of input.rivals) {
      const bid = rivalBid(rival, input, rng);
      if (bid === null) continue;
      if (bid > top) {
        top = bid;
        topPosition = rival.waiverPosition;
      } else if (bid === top) {
        if (
          rival.waiverPosition !== null &&
          (topPosition === null || rival.waiverPosition < topPosition)
        ) {
          topPosition = rival.waiverPosition;
        }
      }
    }
    if (top < 0) {
      noRivalRuns += 1;
      tops.push(-1);
      topPositions.push(null);
    } else {
      tops.push(top);
      topPositions.push(topPosition);
    }
  }

  const contested = tops.filter((t) => t >= 0).sort((a, b) => a - b);

  function winChanceAt(dollars: number): number {
    if (!Number.isFinite(dollars)) return 0;
    const bid = Math.max(0, Math.round(dollars));
    // Below the league's minimum the claim is not accepted at all, so it wins
    // nothing, not even an uncontested auction.
    if (bid < input.minBid) return 0;
    let wins = 0;
    for (let i = 0; i < tops.length; i += 1) {
      const top = tops[i];
      if (top < 0) {
        wins += 1;
        continue;
      }
      if (bid > top) {
        wins += 1;
        continue;
      }
      if (bid === top) {
        // The tiebreak. When we know both waiver positions, the lower number
        // wins outright. When we do not, half: an even split is the honest
        // answer, and pretending otherwise would bias every round-number bid.
        const theirs = topPositions[i];
        if (input.yourWaiverPosition !== null && theirs !== null) {
          wins += input.yourWaiverPosition < theirs ? 1 : 0;
        } else {
          wins += 0.5;
        }
      }
    }
    return clamp(wins / tops.length, 0, 1);
  }

  return {
    winChanceAt,
    rivalTop: {
      p50: quantile(contested, 0.5),
      p75: quantile(contested, 0.75),
      p90: quantile(contested, 0.9),
    },
    noRivalShare: noRivalRuns / runs,
    interestedCount: input.rivals.filter((r) => r.interested).length,
  };
}
