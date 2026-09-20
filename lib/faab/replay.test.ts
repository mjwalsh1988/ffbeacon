import { describe, expect, it } from "vitest";

import { DEFAULT_FAAB_SETTINGS } from "./default-settings";
import type { PriorCell } from "./priors-math";
import {
  gradeBid,
  replayAuctions,
  replayOne,
  replayOptionsFrom,
  type ReplayAuction,
  type ReplayOptions,
} from "./replay";

/**
 * One cell wide enough that the fallback ladder never has to move: every
 * lookup in these tests lands on it, so a test is about the grading rather
 * than about which cell got picked (priors-read.test.ts owns that).
 */
function cell(over: Partial<PriorCell> = {}): PriorCell {
  const key = over.cellKey ?? "any|any|any|any|any";
  const [leagueKind, superflex, position, phase, bidders] = key.split("|");
  return {
    cellKey: key,
    leagueKind: leagueKind as PriorCell["leagueKind"],
    superflex: superflex as PriorCell["superflex"],
    position,
    phase,
    bidders: bidders as PriorCell["bidders"],
    sampleSize: 500,
    zeroShare: 0,
    p05: 1,
    p10: 2,
    p25: 5,
    p50: 10,
    p75: 20,
    p90: 35,
    p95: 50,
    p99: 80,
    runnerUpRatioP50: 2,
    leaguesCount: 40,
    seasons: [2024, 2025],
    builtAt: "2026-09-19T12:00:00.000Z",
    ...over,
  };
}

const CELLS = [cell()];

function options(over: Partial<ReplayOptions> = {}): ReplayOptions {
  return { ...replayOptionsFrom(DEFAULT_FAAB_SETTINGS), oddNudge: false, ...over };
}

let seq = 0;

function auction(over: Partial<ReplayAuction> = {}): ReplayAuction {
  seq += 1;
  const totalBudget = over.totalBudget ?? 100;
  const winningAmount = over.winningAmount ?? 10;
  return {
    leagueId: "league-a",
    season: 2025,
    week: 4,
    leagueKind: "redraft",
    superflex: false,
    position: "RB",
    aliveFraction: null,
    totalBudget,
    bids: [
      { rosterId: seq * 2, amount: winningAmount, pct: (winningAmount / totalBudget) * 100 },
      { rosterId: seq * 2 + 1, amount: 1, pct: (1 / totalBudget) * 100 },
    ],
    winningAmount,
    winningPct: (winningAmount / totalBudget) * 100,
    ...over,
  };
}

/** What the value bid comes out at for the shared cell, at heat 1. */
function valueBidFor(over: Partial<ReplayAuction> = {}): number {
  const outcome = replayOne(auction(over), CELLS, options(), 1);
  if (!outcome) throw new Error("expected the shared cell to price this auction");
  return outcome.valueBid;
}

describe("gradeBid", () => {
  it("counts a bid above the real winner as a win", () => {
    expect(gradeBid(12, 10)).toBe(1);
  });

  it("counts a bid below the real winner as a loss", () => {
    expect(gradeBid(8, 10)).toBe(0);
  });

  it("counts a bid level with the real winner as half a win", () => {
    expect(gradeBid(10, 10)).toBe(0.5);
  });
});

describe("replayOne", () => {
  it("prices off the total bidders, because that is what the cell counts", () => {
    // The cell dimension counts every bidder including the winner, so a room
    // of three reads the three-bidder cell. Reading the two-bidder cell here
    // would subtract a reader the dimension never double counted, and price a
    // contested auction off a thinner room's distribution.
    const cells = [
      cell({ cellKey: "any|any|any|any|2", p50: 4 }),
      cell({ cellKey: "any|any|any|any|3", p50: 40 }),
    ];
    const three = auction({
      bids: [
        { rosterId: 1, amount: 10, pct: 10 },
        { rosterId: 2, amount: 6, pct: 6 },
        { rosterId: 3, amount: 2, pct: 2 },
      ],
    });
    const outcome = replayOne(three, cells, options(), 1);
    expect(outcome?.cellKey).toBe("any|any|any|any|3");
  });

  it("returns null when no cell covers the auction", () => {
    expect(replayOne(auction(), [], options(), 1)).toBeNull();
  });

  it("asks for more money in a league that pays over the odds", () => {
    const cool = replayOne(auction(), CELLS, options(), 1);
    const hot = replayOne(auction(), CELLS, options(), 1.8);
    expect((hot?.valueBid ?? 0) > (cool?.valueBid ?? 0)).toBe(true);
  });

  it("nudges a round bid up by a dollar when the setting is on", () => {
    // Tuned so the value target lands exactly on 15, which is the case the
    // nudge exists for: ties are common on round numbers.
    const round = [cell({ p50: 11, p75: 21 })];
    const plain = replayOne(auction(), round, options({ oddNudge: false }), 1);
    const nudged = replayOne(auction(), round, options({ oddNudge: true }), 1);
    expect(plain?.valueBid).toBe(15);
    expect(nudged?.valueBid).toBe(16);
  });
});

describe("replayAuctions", () => {
  it("grades a beaten winner as a win and a missed one as a loss", () => {
    const bid = valueBidFor();
    const won = auction({ winningAmount: Math.max(0, bid - 5) });
    const lost = auction({ winningAmount: bid + 40 });

    const { summary } = replayAuctions([won], CELLS, options());
    expect(summary.overall.valueWinShare).toBe(1);

    const missed = replayAuctions([lost], CELLS, options());
    expect(missed.summary.overall.valueWinShare).toBe(0);
  });

  it("splits a tie with the real winner down the middle", () => {
    const bid = valueBidFor();
    const { summary } = replayAuctions([auction({ winningAmount: bid })], CELLS, options());
    expect(summary.overall.valueWinShare).toBe(0.5);
  });

  it("wins at least as often on the sure goal as on the value goal", () => {
    const rows = [1, 4, 8, 12, 18, 25, 40, 60].map((winningAmount) =>
      auction({ winningAmount, week: 4 }),
    );
    const { summary } = replayAuctions(rows, CELLS, options());
    expect(summary.overall.sureWinShare).toBeGreaterThanOrEqual(summary.overall.valueWinShare);
    expect(summary.overall.sureWinShare).toBeGreaterThan(0);
  });

  it("measures overpay only on the auctions it would have won", () => {
    const bid = valueBidFor();
    const rows = [
      auction({ winningAmount: bid - 4 }),
      auction({ winningAmount: bid + 30 }),
      auction({ winningAmount: bid + 40 }),
    ];
    const { summary } = replayAuctions(rows, CELLS, options());

    expect(summary.overall.sampleSize).toBe(3);
    // One win, so one overpay reading, and it is that win's margin.
    expect(summary.overall.valueWins).toBe(1);
    expect(summary.overall.valueMedianOverpayPct).toBeCloseTo(4, 6);
  });

  it("leaves a tie out of the overpay sample, because a tie overpaid nothing", () => {
    const bid = valueBidFor();
    const { summary } = replayAuctions([auction({ winningAmount: bid })], CELLS, options());
    expect(summary.overall.valueWins).toBe(0);
    expect(summary.overall.valueMedianOverpayPct).toBeNull();
  });

  it("reports overpay as a share of the budget, not in dollars", () => {
    // A $1,000 league and a $100 league with the same margin in budget terms
    // must produce the same overpay figure.
    const small = replayAuctions(
      [auction({ totalBudget: 100, winningAmount: valueBidFor() - 3 })],
      CELLS,
      options(),
    );
    const bigBid = valueBidFor({ totalBudget: 1000 });
    const big = replayAuctions(
      [auction({ totalBudget: 1000, winningAmount: bigBid - 30 })],
      CELLS,
      options(),
    );
    expect(small.summary.overall.valueMedianOverpayPct).toBeCloseTo(3, 6);
    expect(big.summary.overall.valueMedianOverpayPct).toBeCloseTo(3, 6);
  });

  it("splits the buckets by phase", () => {
    const rows = [
      auction({ week: 4 }),
      auction({ week: 5 }),
      auction({ week: 9 }),
      auction({ week: 16 }),
    ];
    const { summary } = replayAuctions(rows, CELLS, options());

    const keys = summary.standard.map((b) => b.key);
    expect(keys).toEqual(["wk2_6", "wk7_10", "wk14p"]);
    expect(summary.standard.find((b) => b.key === "wk2_6")?.sampleSize).toBe(2);
    expect(summary.standard.find((b) => b.key === "wk7_10")?.sampleSize).toBe(1);
    expect(summary.standard.find((b) => b.key === "wk14p")?.sampleSize).toBe(1);
    expect(summary.chopped).toEqual([]);
    expect(summary.overall.sampleSize).toBe(4);
  });

  it("buckets a chopped league by how much of the field is left", () => {
    const base = { leagueKind: "chopped" as const, leagueId: "chopped-a" };
    const rows = [
      auction({ ...base, week: 1, aliveFraction: 0.9 }),
      auction({ ...base, week: 8, aliveFraction: 0.4 }),
      auction({ ...base, week: 14, aliveFraction: 0.1 }),
    ];
    const { summary } = replayAuctions(rows, CELLS, options());

    expect(summary.chopped.map((b) => b.key)).toEqual([
      "alive_50p",
      "alive_30_50",
      "alive_lt30",
    ]);
    expect(summary.standard).toEqual([]);
    // Week 1 counts in a chopped league: the pool is a whole roster and
    // everybody is already bidding.
    expect(summary.overall.sampleSize).toBe(3);
  });

  it("skips uncontested auctions and standard week 1", () => {
    const rows = [
      auction({ week: 1 }),
      auction({ week: 4, bids: [{ rosterId: 1, amount: 10, pct: 10 }] }),
      auction({ week: 4 }),
    ];
    const { summary } = replayAuctions(rows, CELLS, options());
    expect(summary.graded).toBe(1);
    expect(summary.skipped).toBe(2);
  });

  it("counts auctions it cannot price rather than grading them", () => {
    const { summary } = replayAuctions([auction()], [], options());
    expect(summary.graded).toBe(0);
    expect(summary.unpriced).toBe(1);
  });

  it("returns zeroed metrics for an empty input rather than NaN", () => {
    const { summary, outcomes } = replayAuctions([], CELLS, options());

    expect(outcomes).toEqual([]);
    expect(summary.graded).toBe(0);
    expect(summary.leagues).toBe(0);
    expect(summary.overall.sampleSize).toBe(0);
    expect(summary.overall.valueWinShare).toBe(0);
    expect(summary.overall.sureWinShare).toBe(0);
    expect(Number.isNaN(summary.overall.valueWinShare)).toBe(false);
    expect(Number.isNaN(summary.overall.sureWinShare)).toBe(false);
    expect(summary.overall.valueMedianOverpayPct).toBeNull();
    expect(summary.overall.sureMedianOverpayPct).toBeNull();
    expect(summary.standard).toEqual([]);
    expect(summary.chopped).toEqual([]);
  });

  it("knows nothing about a league until that league has settled an auction", () => {
    // The first auction of a league has no earlier auctions to measure heat
    // over, so heat is exactly 1 and the bid is the plain market number.
    const first = auction({ leagueId: "fresh", week: 2 });
    const { outcomes } = replayAuctions([first], CELLS, options());
    expect(outcomes[0]?.heat).toBe(1);
  });

  it("never lets an auction inform its own price", () => {
    // Four auctions in one week, all of them wildly over the market. The heat
    // used on every one of them is still 1, because none of them had cleared
    // when the others were filed.
    const week = [1, 2, 3, 4].map((n) =>
      auction({ leagueId: "hot", week: 3, winningAmount: 70, bids: [
        { rosterId: n, amount: 70, pct: 70 },
        { rosterId: n + 10, amount: 60, pct: 60 },
      ] }),
    );
    const { outcomes } = replayAuctions(week, CELLS, options());
    expect(outcomes.every((o) => o.heat === 1)).toBe(true);
  });

  it("carries a hot league's earlier weeks into a later week's price", () => {
    const hot = (week: number) =>
      auction({
        leagueId: "hot",
        week,
        winningAmount: 70,
        bids: [
          { rosterId: 1, amount: 70, pct: 70 },
          { rosterId: 2, amount: 60, pct: 60 },
        ],
      });
    const rows = [hot(2), hot(3), hot(4), hot(5), hot(6)];
    const { outcomes } = replayAuctions(rows, CELLS, options());
    expect(outcomes[0].heat).toBe(1);
    expect(outcomes[outcomes.length - 1].heat).toBeGreaterThan(1);
  });

  it("counts distinct leagues behind the graded auctions", () => {
    const rows = [
      auction({ leagueId: "a" }),
      auction({ leagueId: "a" }),
      auction({ leagueId: "b" }),
    ];
    const { summary } = replayAuctions(rows, CELLS, options());
    expect(summary.leagues).toBe(2);
  });
});
