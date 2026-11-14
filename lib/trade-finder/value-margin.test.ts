import { describe, it, expect } from "vitest";
import {
  consolidatedTotals,
  largerShareToMarginPct,
  marginToLargerShare,
  valueMarginOf,
  valueMarginPct,
} from "./value-margin";
import { DEFAULT_TRADE_QUALITY_CONFIG, solveTradeBalance } from "@/lib/trade-quality";

describe("the shared value percent", () => {
  it("is Signal Check's |A - B| / (A + B)", () => {
    expect(valueMarginPct(6000, 4000)).toBeCloseTo(20, 6);
    expect(valueMarginPct(0, 0)).toBe(0);
  });

  it("converts to and from the larger-side share without moving a threshold", () => {
    for (const share of [0.05, 0.08, 0.15, 0.26]) {
      expect(marginToLargerShare(largerShareToMarginPct(share))).toBeCloseTo(share, 9);
    }
    // 100 against 80: 20% of the larger side, 11.1% of both together.
    expect(marginToLargerShare(valueMarginPct(100, 80))).toBeCloseTo(0.2, 9);
  });

  it("says who gains", () => {
    expect(valueMarginOf(6000, 4000).favors).toBe("you");
    expect(valueMarginOf(4000, 6000).favors).toBe("them");
    expect(valueMarginOf(5000, 5050).favors).toBe("even");
  });
});

describe("the consolidation step", () => {
  it("matches Signal Check's balance on a two-for-one", () => {
    const totals = consolidatedTotals([6000], [3200, 3000], {
      config: DEFAULT_TRADE_QUALITY_CONFIG,
      poolMax: 9900,
    });
    const balance = solveTradeBalance([6000], [3200, 3000], 9900, DEFAULT_TRADE_QUALITY_CONFIG);
    expect(totals.valueIn).toBeCloseTo(balance.effective.a, 6);
    expect(totals.valueOut).toBeCloseTo(balance.effective.b, 6);
    // The one better piece is worth more than the raw sum says.
    expect(totals.valueIn).toBeGreaterThan(6000);
  });

  it("leaves a one-for-one alone and drops unpriced zeros", () => {
    expect(consolidatedTotals([5000], [4800])).toEqual({ valueIn: 5000, valueOut: 4800, adjustment: 0 });
    expect(consolidatedTotals([5000, 0], [4800]).valueIn).toBe(5000);
  });
});
