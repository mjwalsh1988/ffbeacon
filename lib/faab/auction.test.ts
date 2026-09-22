import { describe, expect, it } from "vitest";

import { simulateAuction, type AuctionInput, type AuctionRival } from "./auction";
import { DEFAULT_FAAB_SETTINGS } from "./default-settings";
import type { PriorCell } from "./priors-read";

const SETTINGS = { ...DEFAULT_FAAB_SETTINGS.auction, runs: 2000 };

function rival(over: Partial<AuctionRival> = {}): AuctionRival {
  return {
    rosterId: 1,
    budgetPct: 100,
    interested: true,
    centerPct: 20,
    waiverPosition: null,
    ...over,
  };
}

function input(over: Partial<AuctionInput> = {}): AuctionInput {
  return {
    yourBudgetPct: 100,
    yourWaiverPosition: null,
    rivals: [rival()],
    strayCell: null,
    settings: SETTINGS,
    seed: 12345,
    totalBudget: 100,
    minBid: 0,
    ...over,
  };
}

function cell(): PriorCell {
  return {
    cellKey: "any|any|any|any|any",
    leagueKind: "any",
    superflex: "any",
    position: "any",
    phase: "any",
    bidders: "any",
    sampleSize: 500,
    zeroShare: 0.3,
    p05: 0,
    p10: 0,
    p25: 1,
    p50: 3,
    p75: 8,
    p90: 18,
    p95: 30,
    p99: 60,
    runnerUpRatioP50: 2,
    leaguesCount: 50,
    seasons: [2025],
    builtAt: "2026-09-19T00:00:00.000Z",
  };
}

describe("determinism", () => {
  it("gives the same curve twice for one seed", () => {
    const a = simulateAuction(input());
    const b = simulateAuction(input());
    expect(a.winChanceAt(20)).toBe(b.winChanceAt(20));
    expect(a.rivalTop).toEqual(b.rivalTop);
  });

  it("gives a different curve for a different seed, but a similar one", () => {
    const a = simulateAuction(input({ seed: 1 }));
    const b = simulateAuction(input({ seed: 2 }));
    expect(Math.abs(a.winChanceAt(20) - b.winChanceAt(20))).toBeLessThan(0.05);
  });
});

describe("the win curve", () => {
  it("never decreases as the bid rises", () => {
    const curve = simulateAuction(input({ rivals: [rival(), rival({ rosterId: 2 })] }));
    let last = -1;
    for (let dollars = 0; dollars <= 100; dollars += 1) {
      const value = curve.winChanceAt(dollars);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });

  it("stays inside 0 and 1", () => {
    const curve = simulateAuction(input());
    for (const bid of [-10, 0, 1, 50, 100, 1000]) {
      expect(curve.winChanceAt(bid)).toBeGreaterThanOrEqual(0);
      expect(curve.winChanceAt(bid)).toBeLessThanOrEqual(1);
    }
  });

  it("reaches near certainty at the top of the budget", () => {
    const curve = simulateAuction(input());
    expect(curve.winChanceAt(100)).toBeGreaterThan(0.95);
  });

  it("is near certain at a token bid when nobody wants him", () => {
    const curve = simulateAuction(input({ rivals: [rival({ interested: false })] }));
    expect(curve.winChanceAt(1)).toBeGreaterThan(0.9);
    expect(curve.noRivalShare).toBeGreaterThan(0.9);
  });

  it("is certain at a token bid when there are no rivals at all", () => {
    const curve = simulateAuction(input({ rivals: [] }));
    expect(curve.winChanceAt(0)).toBe(1);
    expect(curve.noRivalShare).toBe(1);
  });

  it("falls at a fixed bid as more rivals want him", () => {
    const one = simulateAuction(input({ rivals: [rival()] })).winChanceAt(20);
    const three = simulateAuction(
      input({
        rivals: [rival(), rival({ rosterId: 2 }), rival({ rosterId: 3 })],
      }),
    ).winChanceAt(20);
    expect(three).toBeLessThan(one);
  });

  it("wins nothing below the league's minimum bid", () => {
    const curve = simulateAuction(input({ minBid: 1, rivals: [] }));
    expect(curve.winChanceAt(0)).toBe(0);
    expect(curve.winChanceAt(1)).toBe(1);
  });
});

describe("rival budgets", () => {
  it("caps a rival at what it actually has left", () => {
    const curve = simulateAuction(
      input({ rivals: [rival({ centerPct: 80, budgetPct: 10 })] }),
    );
    expect(curve.rivalTop.p90).toBeLessThanOrEqual(10);
    expect(curve.winChanceAt(11)).toBe(1);
  });

  it("treats a broke rival as no rival", () => {
    const curve = simulateAuction(input({ rivals: [rival({ budgetPct: 0 })] }));
    expect(curve.winChanceAt(1)).toBe(1);
  });
});

describe("bid discipline", () => {
  it("bids a share of worth rather than worth itself", () => {
    const settings = { ...SETTINGS, bidSigma: 0.0001, participation: 1, strayBidRate: 0 };
    const full = simulateAuction(
      input({
        settings: { ...settings, worthToBidRatio: 1 },
        rivals: [rival({ centerPct: 60 })],
      }),
    );
    const disciplined = simulateAuction(
      input({
        settings: { ...settings, worthToBidRatio: 0.3 },
        rivals: [rival({ centerPct: 60 })],
      }),
    );
    expect(full.rivalTop.p50).toBe(60);
    expect(disciplined.rivalTop.p50).toBe(18);
  });

  /**
   * The scarcity premium pulls the opposite way to the discipline, on purpose.
   * A rival bids well under their valuation on an ordinary add and well over
   * their lineup arithmetic on a player who will not reach a wire again.
   */
  it("raises rival bids for a player who does not normally reach a wire", () => {
    const settings = {
      ...SETTINGS,
      bidSigma: 0.0001,
      participation: 1,
      strayBidRate: 0,
      worthToBidRatio: 0.5,
      scarcityPremiumPct: 40,
    };
    const ordinary = simulateAuction(
      input({ settings, rivals: [rival({ centerPct: 40 })], scarcityShare: 0 }),
    );
    const scarce = simulateAuction(
      input({ settings, rivals: [rival({ centerPct: 40 })], scarcityShare: 1 }),
    );
    expect(ordinary.rivalTop.p50).toBe(20);
    expect(scarce.rivalTop.p50).toBe(28);
  });

  /**
   * "We do not know how scarce he is" is not the same statement as "he is not
   * scarce", so an unpriced player gets no premium rather than a guessed one.
   */
  it("applies no premium when we hold no market value for him", () => {
    const settings = {
      ...SETTINGS,
      bidSigma: 0.0001,
      participation: 1,
      strayBidRate: 0,
      worthToBidRatio: 0.5,
      scarcityPremiumPct: 40,
    };
    const unknown = simulateAuction(
      input({ settings, rivals: [rival({ centerPct: 40 })], scarcityShare: null }),
    );
    expect(unknown.rivalTop.p50).toBe(20);
  });

  it("leaves a stray bidder alone: they bid the market, not a valuation", () => {
    const settings = {
      ...SETTINGS,
      bidSigma: 0.0001,
      participation: 0,
      strayBidRate: 1,
      worthToBidRatio: 0.1,
    };
    const curve = simulateAuction(
      input({
        settings,
        strayCell: cell(),
        rivals: [rival({ interested: false, centerPct: 60 })],
      }),
    );
    // The cell's own median, untouched by the ratio.
    expect(curve.rivalTop.p50).toBeGreaterThanOrEqual(2);
  });
});

describe("ties", () => {
  it("splits a tie down the middle when waiver order is unknown", () => {
    // One rival who always bids, with no spread, so every run ties at 20.
    // The ratio is pinned at 1 here so `centerPct` is the bid: this is a test
    // of the tie rule, not of how hard a rival bids.
    const curve = simulateAuction(
      input({
        settings: {
          ...SETTINGS,
          bidSigma: 0.1,
          participation: 1,
          strayBidRate: 0,
          worthToBidRatio: 1,
        },
        rivals: [rival({ centerPct: 20, waiverPosition: null })],
        yourWaiverPosition: null,
      }),
    );
    const atTie = curve.winChanceAt(20);
    expect(atTie).toBeGreaterThan(curve.winChanceAt(19));
    expect(atTie).toBeLessThan(curve.winChanceAt(21));
  });

  it("wins every tie when the reader has the earlier waiver position", () => {
    const tieSettings = {
      ...SETTINGS,
      bidSigma: 0.0001,
      participation: 1,
      strayBidRate: 0,
      worthToBidRatio: 1,
    };
    const ahead = simulateAuction(
      input({
        settings: tieSettings,
        rivals: [rival({ centerPct: 20, waiverPosition: 8 })],
        yourWaiverPosition: 2,
      }),
    );
    const behind = simulateAuction(
      input({
        settings: tieSettings,
        rivals: [rival({ centerPct: 20, waiverPosition: 2 })],
        yourWaiverPosition: 8,
      }),
    );
    expect(ahead.winChanceAt(20)).toBeGreaterThan(behind.winChanceAt(20));
  });
});

describe("stray bids", () => {
  it("lets an uninterested rival bid out of the market cell now and then", () => {
    const withCell = simulateAuction(
      input({
        rivals: [rival({ interested: false })],
        strayCell: cell(),
        settings: { ...SETTINGS, strayBidRate: 1 },
      }),
    );
    expect(withCell.noRivalShare).toBe(0);
    expect(withCell.rivalTop.p90).toBeGreaterThan(0);
  });
});

describe("chopped substitutes", () => {
  it("lowers the price when several comparable players hit waivers at once", () => {
    const alone = simulateAuction(
      input({ rivals: [rival(), rival({ rosterId: 2 }), rival({ rosterId: 3 })] }),
    ).winChanceAt(15);
    const crowded = simulateAuction(
      input({
        rivals: [rival(), rival({ rosterId: 2 }), rival({ rosterId: 3 })],
        participationScale: 0.4,
      }),
    ).winChanceAt(15);
    expect(crowded).toBeGreaterThan(alone);
  });
});

describe("the reported rival top bid", () => {
  it("rises through its own quantiles", () => {
    const curve = simulateAuction(
      input({ rivals: [rival(), rival({ rosterId: 2 }), rival({ rosterId: 3 })] }),
    );
    expect(curve.rivalTop.p50).toBeLessThanOrEqual(curve.rivalTop.p75);
    expect(curve.rivalTop.p75).toBeLessThanOrEqual(curve.rivalTop.p90);
  });

  it("scales into the league's own dollars", () => {
    const small = simulateAuction(input({ totalBudget: 100 }));
    const big = simulateAuction(input({ totalBudget: 1000 }));
    expect(big.rivalTop.p50).toBeGreaterThan(small.rivalTop.p50 * 5);
  });
});

describe("calibration against our own auction data", () => {
  /**
   * Plan 7.7 sets two targets from 16,409 real auctions: the winner pays
   * about twice the runner-up (median 2.0), and a value-goal bid should win
   * 60 to 75% of contested auctions. This checks the shape the model produces
   * rather than any one number.
   */
  it("produces a spread of rival bids wide enough to price a contest", () => {
    const curve = simulateAuction(
      input({
        rivals: [
          rival({ rosterId: 1, centerPct: 18 }),
          rival({ rosterId: 2, centerPct: 12 }),
          rival({ rosterId: 3, centerPct: 8 }),
        ],
      }),
    );
    expect(curve.rivalTop.p90 / Math.max(1, curve.rivalTop.p50)).toBeGreaterThan(1.3);
  });

  it("puts a bid at the rivals' median top somewhere near a coin flip", () => {
    const curve = simulateAuction(
      input({
        rivals: [rival({ rosterId: 1 }), rival({ rosterId: 2, centerPct: 14 })],
      }),
    );
    const atMedian = curve.winChanceAt(curve.rivalTop.p50);
    expect(atMedian).toBeGreaterThan(0.35);
    expect(atMedian).toBeLessThan(0.8);
  });
});
