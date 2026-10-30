import { describe, expect, it } from "vitest";
import { computeShares } from "./shares";

describe("computeShares", () => {
  const rosters = [
    { rosterId: 1, totalValue: 30000, pointsFor: 800 },
    { rosterId: 2, totalValue: 50000, pointsFor: 900 },
    { rosterId: 3, totalValue: 20000, pointsFor: 800 },
  ];

  it("computes both shares to one decimal and ranks production with a roster id tie break", () => {
    const s = computeShares(rosters, 3, 3);
    expect(s.value).toEqual({ pct: 20, rank: 3 });
    expect(s.production).toEqual({ pct: 32, rank: 3 });
    expect(computeShares(rosters, 1, 2).production.rank).toBe(2);
  });

  it("is null for production in the preseason", () => {
    const pre = rosters.map((r) => ({ ...r, pointsFor: 0 }));
    expect(computeShares(pre, 1, 2).production).toEqual({ pct: null, rank: null });
  });
});
