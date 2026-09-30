import { describe, it, expect } from "vitest";
import { DEFAULT_FAAB_SETTINGS } from "@/lib/faab/default-settings";
import type { PriorCell } from "@/lib/faab/priors-math";
import { boardBid, estimateBidders, ownQuantile, priorLeagueKind } from "./bid";
import type { ClaimMarket } from "./types";

/** One market cell, "any" on every dimension but the bidder count. */
function cell(bidders: PriorCell["bidders"], q: Partial<PriorCell> = {}): PriorCell {
  return {
    cellKey: `any|any|any|any|${bidders}`,
    leagueKind: "any",
    superflex: "any",
    position: "any",
    phase: "any",
    bidders,
    sampleSize: 500,
    zeroShare: 0,
    p05: 0,
    p10: 1,
    p25: 5,
    p50: 10,
    p75: 20,
    p90: 30,
    p95: 40,
    p99: 60,
    runnerUpRatioP50: null,
    leaguesCount: 100,
    seasons: [2026],
    builtAt: "2026-09-29T00:00:00Z",
    ...q,
  };
}

/** Real-shaped cells: the price climbs with the number of teams bidding. */
const CELLS: PriorCell[] = [
  cell("1", { zeroShare: 0.5, p05: 0, p10: 0, p25: 0, p50: 0, p75: 3, p90: 9, p95: 14, p99: 25 }),
  cell("2", { zeroShare: 0.2, p25: 1, p50: 5, p75: 12, p90: 25 }),
  cell("3", { zeroShare: 0.05, p25: 5, p50: 12, p75: 25, p90: 45 }),
  cell("4p", { zeroShare: 0, p25: 12, p50: 25, p75: 40, p90: 70, p95: 80, p99: 95 }),
];

function market(over: Partial<ClaimMarket> = {}): ClaimMarket {
  return {
    auctions: 40,
    leagues: 40,
    avgBidders: 4.1,
    contestedShare: 0.88,
    p25: 27.5,
    p50: 46,
    p75: 70,
    p90: 98,
    latestWeek: 3,
    ...over,
  };
}

const BASE = {
  position: "RB" as const,
  leagueKind: "dynasty" as const,
  superflex: true,
  week: 4,
  pointsAboveReplacement: null,
  touchDelta: null,
  rosterPct: null,
  market: null,
  cells: CELLS,
  settings: DEFAULT_FAAB_SETTINGS,
};

describe("boardBid", () => {
  it("prices a contested player far above the old deep-flyer band", () => {
    // The regression this file exists for: a back four teams fought over at a
    // median of 46 percent printed "0 to 2" under the rank curve.
    const bid = boardBid({ ...BASE, market: market() });
    expect(bid).not.toBeNull();
    expect(bid!.lowPct).toBeGreaterThanOrEqual(40);
    expect(bid!.highPct).toBeGreaterThanOrEqual(80);
    expect(bid!.basis).toBe("claims");
    expect(bid!.bidders).toBe("4p");
    expect(bid!.tier).toBe("priority");
  });

  it("returns whole percentages with the value bid never above the sure bid", () => {
    for (const m of [null, market({ auctions: 3, p25: 0, p50: 1, p75: 4, p90: 9 }), market()]) {
      const bid = boardBid({ ...BASE, market: m })!;
      expect(Number.isInteger(bid.lowPct)).toBe(true);
      expect(Number.isInteger(bid.highPct)).toBe(true);
      expect(bid.lowPct).toBeLessThanOrEqual(bid.highPct);
      expect(bid.highPct).toBeLessThanOrEqual(100);
    }
  });

  it("prices a player nobody is chasing as a free or cheap claim from the market", () => {
    const bid = boardBid({ ...BASE, pointsAboveReplacement: -8, rosterPct: 2 })!;
    expect(bid.bidders).toBe("1");
    expect(bid.basis).toBe("market");
    expect(bid.highPct).toBeLessThan(10);
  });

  it("leans on the market when he has only a couple of his own auctions", () => {
    const thin = market({ auctions: 2, leagues: 2, avgBidders: 1, p25: 0, p50: 0, p75: 0, p90: 0 });
    const bid = boardBid({ ...BASE, market: thin, pointsAboveReplacement: 1, touchDelta: 8, rosterPct: 60 })!;
    expect(bid.basis).toBe("blended");
    // Two free claims must not drag a contested profile to zero.
    expect(bid.highPct).toBeGreaterThan(0);
  });

  it("ignores a single auction of his own", () => {
    const one = market({ auctions: 1, leagues: 1 });
    expect(boardBid({ ...BASE, market: one })!.basis).toBe("market");
  });

  it("says nothing rather than zero when there is nothing measured", () => {
    expect(boardBid({ ...BASE, cells: [], market: null })).toBeNull();
  });

  it("still prices from his own claims when the market cells are missing", () => {
    const bid = boardBid({ ...BASE, cells: [], market: market() })!;
    expect(bid.basis).toBe("claims");
    expect(bid.lowPct).toBeGreaterThan(40);
  });
});

describe("estimateBidders", () => {
  const base = {
    position: "WR" as const,
    pointsAboveReplacement: null,
    touchDelta: null,
    rosterPct: null,
    superflex: false,
    market: null,
  };

  it("reads the crowd off his own auctions when there are enough", () => {
    expect(estimateBidders({ ...base, market: market({ auctions: 5, avgBidders: 1.2 }) })).toBe("1");
    expect(estimateBidders({ ...base, market: market({ auctions: 5, avgBidders: 3.9 }) })).toBe("4p");
  });

  it("expects a crowd for a startable player whose role just grew", () => {
    expect(
      estimateBidders({ ...base, pointsAboveReplacement: 3, touchDelta: 9, rosterPct: 65 }),
    ).toBe("4p");
  });

  it("never expects more than two bidders on a kicker or defense", () => {
    expect(
      estimateBidders({ ...base, position: "DEF", pointsAboveReplacement: 5, touchDelta: 9, rosterPct: 69 }),
    ).toBe("2");
  });

  it("adds a bidder for a superflex quarterback", () => {
    const one = estimateBidders({ ...base, position: "QB" });
    const sf = estimateBidders({ ...base, position: "QB", superflex: true });
    expect(one).toBe("1");
    expect(sf).toBe("2");
  });
});

describe("ownQuantile", () => {
  it("interpolates between the published quantiles and holds flat past the ends", () => {
    const m = market({ p25: 10, p50: 20, p75: 40, p90: 70 });
    expect(ownQuantile(m, 0.1)).toBe(10);
    expect(ownQuantile(m, 0.5)).toBe(20);
    expect(ownQuantile(m, 0.6)).toBeCloseTo(28, 5);
    expect(ownQuantile(m, 0.9)).toBe(70);
    expect(ownQuantile(m, 0.99)).toBe(70);
  });
});

describe("priorLeagueKind", () => {
  it("prices keeper and unknown leagues as redraft", () => {
    expect(priorLeagueKind("dynasty")).toBe("dynasty");
    expect(priorLeagueKind("redraft")).toBe("redraft");
    expect(priorLeagueKind(null)).toBe("redraft");
  });
});
