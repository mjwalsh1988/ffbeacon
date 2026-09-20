import { describe, expect, it } from "vitest";

import { DEFAULT_FAAB_SETTINGS } from "./default-settings";
import {
  computeLeagueTendencies,
  tendencyFor,
  tendencyLabel,
  type TendencyAuction,
} from "./tendency";

const AUCTION_SETTINGS = DEFAULT_FAAB_SETTINGS.auction;

function auction(over: Partial<TendencyAuction> = {}): TendencyAuction {
  return {
    week: 5,
    winningPct: 10,
    bids: [
      { rosterId: 1, pct: 10 },
      { rosterId: 2, pct: 5 },
    ],
    referencePct: 10,
    ...over,
  };
}

/** n identical auctions, so shrinkage can be exercised at a known sample size. */
function repeat(count: number, over: Partial<TendencyAuction> = {}): TendencyAuction[] {
  return Array.from({ length: count }, () => auction(over));
}

describe("league heat", () => {
  it("is 1 with no history at all", () => {
    const out = computeLeagueTendencies([], AUCTION_SETTINGS);
    expect(out.heat).toBe(1);
    expect(out.heatSamples).toBe(0);
  });

  it("is 1 when the league pays exactly the market price", () => {
    const out = computeLeagueTendencies(repeat(40), AUCTION_SETTINGS);
    expect(out.heat).toBeCloseTo(1, 6);
  });

  it("rises above 1 when the room pays over the odds", () => {
    const out = computeLeagueTendencies(
      repeat(40, { winningPct: 20, bids: [{ rosterId: 1, pct: 20 }, { rosterId: 2, pct: 8 }] }),
      AUCTION_SETTINGS,
    );
    expect(out.heat).toBeGreaterThan(1.3);
  });

  it("falls below 1 when the room is cheap", () => {
    const out = computeLeagueTendencies(
      repeat(40, { winningPct: 4, bids: [{ rosterId: 1, pct: 4 }, { rosterId: 2, pct: 2 }] }),
      AUCTION_SETTINGS,
    );
    expect(out.heat).toBeLessThan(0.8);
  });

  it("shrinks a small sample toward 1", () => {
    const hot = { winningPct: 40, bids: [{ rosterId: 1, pct: 40 }, { rosterId: 2, pct: 10 }] };
    const thin = computeLeagueTendencies(repeat(2, hot), AUCTION_SETTINGS).heat;
    const thick = computeLeagueTendencies(repeat(60, hot), AUCTION_SETTINGS).heat;
    expect(thin).toBeLessThan(thick);
    expect(thin).toBeGreaterThan(1);
  });

  it("never runs away on one absurd auction", () => {
    const out = computeLeagueTendencies(
      repeat(80, {
        winningPct: 100,
        bids: [{ rosterId: 1, pct: 100 }, { rosterId: 2, pct: 1 }],
        referencePct: 0.2,
      }),
      AUCTION_SETTINGS,
    );
    expect(out.heat).toBeLessThanOrEqual(AUCTION_SETTINGS.heatClamp[1]);
  });

  it("ignores week 1, where budgets are full and everybody bids", () => {
    const out = computeLeagueTendencies(
      repeat(30, {
        week: 1,
        winningPct: 50,
        bids: [{ rosterId: 1, pct: 50 }, { rosterId: 2, pct: 20 }],
      }),
      AUCTION_SETTINGS,
    );
    expect(out.heatSamples).toBe(0);
    expect(out.heat).toBe(1);
  });

  it("ignores auctions nobody contested", () => {
    const out = computeLeagueTendencies(
      repeat(30, { winningPct: 40, bids: [{ rosterId: 1, pct: 40 }] }),
      AUCTION_SETTINGS,
    );
    expect(out.heatSamples).toBe(0);
  });

  it("survives a league where everything clears at nothing", () => {
    const out = computeLeagueTendencies(
      repeat(20, {
        winningPct: 0,
        referencePct: 0,
        bids: [{ rosterId: 1, pct: 0 }, { rosterId: 2, pct: 0 }],
      }),
      AUCTION_SETTINGS,
    );
    expect(Number.isFinite(out.heat)).toBe(true);
    expect(out.heat).toBeCloseTo(1, 6);
  });
});

describe("manager tendency", () => {
  it("is 1 for a roster we have never seen bid", () => {
    const out = computeLeagueTendencies(repeat(20), AUCTION_SETTINGS);
    expect(tendencyFor(out, 99)).toBe(1);
  });

  it("is measured against the room, not against the market", () => {
    // Every auction here goes for double the market price, and both managers
    // bid the same as each other. The league is hot; neither manager is.
    const out = computeLeagueTendencies(
      repeat(40, {
        winningPct: 20,
        bids: [{ rosterId: 1, pct: 20 }, { rosterId: 2, pct: 20 }],
      }),
      AUCTION_SETTINGS,
    );
    expect(out.heat).toBeGreaterThan(1.3);
    expect(tendencyFor(out, 1)).toBeCloseTo(1, 1);
    expect(tendencyFor(out, 2)).toBeCloseTo(1, 1);
  });

  it("separates the spender from the holder inside one room", () => {
    const out = computeLeagueTendencies(
      repeat(40, {
        winningPct: 20,
        bids: [{ rosterId: 1, pct: 20 }, { rosterId: 2, pct: 2 }],
      }),
      AUCTION_SETTINGS,
    );
    expect(tendencyFor(out, 1)).toBeGreaterThan(tendencyFor(out, 2));
  });

  it("stays inside the clamp", () => {
    const out = computeLeagueTendencies(
      repeat(60, {
        winningPct: 100,
        referencePct: 1,
        bids: [{ rosterId: 1, pct: 100 }, { rosterId: 2, pct: 0 }],
      }),
      AUCTION_SETTINGS,
    );
    const [min, max] = AUCTION_SETTINGS.tendencyClamp;
    expect(tendencyFor(out, 1)).toBeLessThanOrEqual(max);
    expect(tendencyFor(out, 2)).toBeGreaterThanOrEqual(min);
  });
});

describe("tendencyLabel", () => {
  it("says so rather than guessing when a manager has barely bid", () => {
    const out = computeLeagueTendencies(repeat(2), AUCTION_SETTINGS);
    expect(tendencyLabel(out, 1)).toBe("Not enough history");
    expect(tendencyLabel(out, 404)).toBe("Not enough history");
  });

  it("names the spender and the holder once there is history", () => {
    const out = computeLeagueTendencies(
      repeat(40, {
        winningPct: 20,
        bids: [{ rosterId: 1, pct: 20 }, { rosterId: 2, pct: 1 }],
      }),
      AUCTION_SETTINGS,
    );
    expect(tendencyLabel(out, 1)).toBe("Spends big");
    expect(tendencyLabel(out, 2)).toBe("Holds money");
  });

  it("calls an average manager typical", () => {
    const out = computeLeagueTendencies(
      repeat(40, {
        winningPct: 10,
        bids: [{ rosterId: 1, pct: 10 }, { rosterId: 2, pct: 9 }],
      }),
      AUCTION_SETTINGS,
    );
    expect(tendencyLabel(out, 1)).toBe("Typical");
  });
});
