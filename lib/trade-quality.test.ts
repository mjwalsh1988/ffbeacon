import { describe, it, expect } from "vitest";
import {
  DEFAULT_TRADE_QUALITY_CONFIG,
  assetQuality,
  compareTradeQuality,
  parsePackageMultipliers,
  poolCeiling,
  qualityBalance,
  sideQuality,
  solveTradeBalance,
} from "./trade-quality";

const CONFIG = DEFAULT_TRADE_QUALITY_CONFIG;
/** A realistic dynasty superflex ceiling, so the curve sits where it would live. */
const POOL = 9900;

describe("assetQuality", () => {
  it("gives a small asset roughly the base share of its value", () => {
    const ceiling = poolCeiling(POOL, 6000, CONFIG);
    const q = assetQuality(500, 6000, ceiling, CONFIG);
    expect(q / 500).toBeGreaterThan(0.1);
    expect(q / 500).toBeLessThan(0.105);
  });

  it("gives the trade's best asset a materially larger share", () => {
    const ceiling = poolCeiling(POOL, 6000, CONFIG);
    const small = assetQuality(500, 6000, ceiling, CONFIG) / 500;
    const big = assetQuality(6000, 6000, ceiling, CONFIG) / 6000;
    expect(big).toBeGreaterThan(small * 1.4);
  });

  it("is zero for a worthless or invalid asset", () => {
    const ceiling = poolCeiling(POOL, 6000, CONFIG);
    expect(assetQuality(0, 6000, ceiling, CONFIG)).toBe(0);
    expect(assetQuality(-100, 6000, ceiling, CONFIG)).toBe(0);
    expect(assetQuality(Number.NaN, 6000, ceiling, CONFIG)).toBe(0);
  });

  it("rises monotonically with value", () => {
    const ceiling = poolCeiling(POOL, 6000, CONFIG);
    let previous = -1;
    for (const v of [100, 500, 1200, 2400, 3600, 4800, 6000]) {
      const q = assetQuality(v, 6000, ceiling, CONFIG);
      expect(q).toBeGreaterThan(previous);
      previous = q;
    }
  });
});

describe("poolCeiling", () => {
  it("falls back to the trade's own best asset when the pool max is unknown", () => {
    expect(poolCeiling(null, 6000, CONFIG)).toBe(6000 + CONFIG.poolPadding);
  });

  it("never sits below the trade's best asset", () => {
    expect(poolCeiling(1000, 6000, CONFIG)).toBe(6000 + CONFIG.poolPadding);
  });
});

describe("sideQuality package discounts", () => {
  const ceiling = poolCeiling(POOL, 5498, CONFIG);

  it("leaves assets at or above half the best asset undiscounted", () => {
    const side = sideQuality([3000, 2800], 5498, ceiling, CONFIG);
    expect(side.pieces.every((p) => p.multiplier === 1)).toBe(true);
    expect(side.discountedCount).toBe(0);
  });

  it("discounts the second and later package pieces, best first", () => {
    const side = sideQuality([2190, 2164, 1531], 5498, ceiling, CONFIG);
    expect(side.pieces.map((p) => p.multiplier)).toEqual([1, 0.85, 0.7]);
    expect(side.discountedCount).toBe(2);
  });

  it("repeats the final multiplier past the end of the list", () => {
    const side = sideQuality([900, 800, 700, 600, 500], 5498, ceiling, CONFIG);
    expect(side.pieces.map((p) => p.multiplier)).toEqual([1, 0.85, 0.7, 0.6, 0.6]);
  });

  it("does not let a package piece count toward the sequence when it clears the threshold", () => {
    // 3000 is above half of 5498, so the 1400 below it is still the FIRST
    // package piece and keeps its full contribution.
    const side = sideQuality([3000, 1400], 5498, ceiling, CONFIG);
    expect(side.pieces.map((p) => p.multiplier)).toEqual([1, 1]);
  });
});

describe("compareTradeQuality", () => {
  it("favours one premium asset over a raw-heavier package of lesser pieces", () => {
    const cmp = compareTradeQuality([5498], [2190, 2164, 1531], POOL, CONFIG);
    expect(cmp.b.rawTotal).toBeGreaterThan(cmp.a.rawTotal);
    expect(cmp.favoured).toBe("a");
  });

  it("still favours a package when its pieces are genuinely strong", () => {
    const cmp = compareTradeQuality([5498], [4900, 4600], POOL, CONFIG);
    expect(cmp.favoured).toBe("b");
  });

  it("is symmetric: swapping the sides swaps the winner", () => {
    const forward = compareTradeQuality([5498], [2190, 2164, 1531], POOL, CONFIG);
    const reversed = compareTradeQuality([2190, 2164, 1531], [5498], POOL, CONFIG);
    expect(forward.favoured).toBe("a");
    expect(reversed.favoured).toBe("b");
    expect(reversed.b.qualityTotal).toBeCloseTo(forward.a.qualityTotal, 6);
  });

  it("calls an identical pair a dead heat", () => {
    const cmp = compareTradeQuality([3000, 1200], [3000, 1200], POOL, CONFIG);
    expect(cmp.favoured).toBeNull();
  });
});

describe("solveTradeBalance", () => {
  it("prices the consolidation gap on the reference trade", () => {
    const result = solveTradeBalance([5498], [2190, 2164, 1531], POOL, CONFIG);
    expect(result.applied).toBe(true);
    expect(result.favoured).toBe("a");
    // Side A is credited enough to overhaul side B's 387-point raw lead.
    expect(result.effective.a).toBeGreaterThan(result.effective.b);
    expect(result.adjustment).toBeGreaterThan(387);
    expect(result.effective.a).toBeCloseTo(5498 + result.adjustment, 6);
    expect(result.effective.b).toBe(5885);
  });

  it("balances: adding the solved asset really does level the two sides", () => {
    const result = solveTradeBalance([5498], [2190, 2164, 1531], POOL, CONFIG);
    const levelled = compareTradeQuality(
      [5498],
      [2190, 2164, 1531, result.balancingAsset],
      POOL,
      CONFIG,
    );
    expect(levelled.a.qualityTotal).toBeCloseTo(levelled.b.qualityTotal, 3);
  });

  it("applies nothing to a one-for-one, however wide the value gap", () => {
    const result = solveTradeBalance([5000], [4500], POOL, CONFIG);
    expect(result.applied).toBe(false);
    expect(result.adjustment).toBe(0);
    expect(result.effective).toEqual({ a: 5000, b: 4500 });
  });

  it("applies nothing when the adjustment would be noise", () => {
    // Two nearly identical two-piece sides: quality separates them, but not by
    // enough to be worth a line on the screen.
    const result = solveTradeBalance([3000, 2000], [2990, 2010], POOL, CONFIG);
    expect(result.applied).toBe(false);
    expect(result.adjustment).toBe(0);
  });

  it("credits the side holding the better single asset in a two-for-two", () => {
    const result = solveTradeBalance([3600, 1400], [2600, 2400], POOL, CONFIG);
    expect(result.favoured).toBe("a");
    expect(result.effective.a).toBeGreaterThan(result.effective.b);
  });

  it("is symmetric: the same trade seen from the other seat gives the same numbers", () => {
    const forward = solveTradeBalance([5498], [2190, 2164, 1531], POOL, CONFIG);
    const reversed = solveTradeBalance([2190, 2164, 1531], [5498], POOL, CONFIG);
    expect(reversed.favoured).toBe("b");
    expect(reversed.adjustment).toBeCloseTo(forward.adjustment, 3);
    expect(reversed.effective.b).toBeCloseTo(forward.effective.a, 3);
    expect(reversed.effective.a).toBeCloseTo(forward.effective.b, 3);
  });

  it("caps rather than running away when a pile of small pieces cannot be balanced", () => {
    const pile = Array.from({ length: 10 }, () => 1000);
    const config = { ...CONFIG, maxAdjustmentPct: 20 };
    const result = solveTradeBalance([9000], pile, POOL, config);
    const combined = 9000 + 10000;
    expect(result.capped).toBe(true);
    expect(result.balancingAsset).toBeLessThanOrEqual(combined * 0.2 + 1);
    expect(result.applied).toBe(true);
  });

  it("needs no adjustment when the favoured side already leads on raw value", () => {
    const result = solveTradeBalance([9000], [10, 10, 10], POOL, CONFIG);
    expect(result.favoured).toBe("a");
    expect(result.applied).toBe(false);
    expect(result.effective).toEqual({ a: 9000, b: 30 });
  });

  it("returns raw totals untouched when a side is empty", () => {
    const result = solveTradeBalance([], [], POOL, CONFIG);
    expect(result.applied).toBe(false);
    expect(result.effective).toEqual({ a: 0, b: 0 });
  });

  it("never mutates the input arrays", () => {
    const a = [5498];
    const b = [2190, 2164, 1531];
    solveTradeBalance(a, b, POOL, CONFIG);
    expect(a).toEqual([5498]);
    expect(b).toEqual([2190, 2164, 1531]);
  });
});

describe("qualityBalance", () => {
  it("reports a package of depth pieces as a shortfall against one starter", () => {
    const { ratio } = qualityBalance([4000], [2200, 2000], POOL, CONFIG);
    expect(ratio).toBeLessThan(0.85);
  });

  it("reports a like-for-like swap as roughly level", () => {
    const { ratio } = qualityBalance([4000], [4050], POOL, CONFIG);
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.1);
  });

  it("reports an overpay above 1", () => {
    const { ratio } = qualityBalance([3000], [4200], POOL, CONFIG);
    expect(ratio).toBeGreaterThan(1.2);
  });
});

describe("parsePackageMultipliers", () => {
  it("reads an admin string", () => {
    expect(parsePackageMultipliers("1, 0.85, 0.7, 0.6")).toEqual([1, 0.85, 0.7, 0.6]);
  });

  it("falls back when the string is empty or unusable", () => {
    expect(parsePackageMultipliers("")).toEqual(CONFIG.packageMultipliers);
    expect(parsePackageMultipliers("nonsense, -2, 7")).toEqual(CONFIG.packageMultipliers);
  });

  it("drops individual out-of-range entries", () => {
    expect(parsePackageMultipliers("1, 5, 0.5")).toEqual([1, 0.5]);
  });
});
