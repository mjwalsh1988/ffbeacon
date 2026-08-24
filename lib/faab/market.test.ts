import { describe, it, expect } from "vitest";
import {
  buildMarket,
  summarizeComparableBids,
  urgencyMultiplier,
  type MarketInput,
} from "./market";
import { DEFAULT_FAAB_SETTINGS } from "./default-settings";

function baseInput(overrides: Partial<MarketInput> = {}): MarketInput {
  return {
    yourBudget: 50,
    rivalBudgets: [50, 50, 50, 50, 50],
    interestedRivals: 1,
    rivalsChecked: 5,
    comparable: null,
    currentWeek: 7,
    lastRegularWeek: 14,
    leagueTotalBudget: 100,
    settings: DEFAULT_FAAB_SETTINGS.market,
    ...overrides,
  };
}

describe("summarizeComparableBids", () => {
  it("drops zero-dollar claims, which are pickups rather than prices", () => {
    const bids = [
      ...Array.from({ length: 10 }, () => ({ amount: 0, season: 2026 })),
      ...[5, 8, 12, 15, 20, 25, 30].map((amount) => ({ amount, season: 2026 })),
    ];
    const summary = summarizeComparableBids(bids, 6);
    expect(summary?.sampleSize).toBe(7);
    expect(summary?.median).toBe(15);
  });

  it("returns null rather than a number built on three data points", () => {
    const bids = [{ amount: 10, season: 2026 }, { amount: 20, season: 2026 }];
    expect(summarizeComparableBids(bids, 6)).toBeNull();
  });
});

describe("rival budget", () => {
  it("discounts when every rival is broke", () => {
    const { read, signals } = buildMarket(
      baseInput({ yourBudget: 60, rivalBudgets: [2, 0, 5, 1, 3] }),
    );
    expect(read.rivalsRicher).toBe(0);
    const signal = signals.find((s) => s.id === "rival-budget");
    expect(signal?.tone).toBe("good");
    expect(signal?.multiplier).toBeLessThan(1);
  });

  it("raises the price when rivals are loaded and you are not", () => {
    const { read, signals } = buildMarket(
      baseInput({ yourBudget: 10, rivalBudgets: [80, 75, 60, 90, 55] }),
    );
    expect(read.rivalsRicher).toBe(5);
    const signal = signals.find((s) => s.id === "rival-budget");
    expect(signal?.tone).toBe("bad");
    expect(signal?.multiplier).toBeGreaterThan(1);
  });

  /**
   * The reported bug. A league where nobody has spent a dollar used to read as
   * a league full of broke rivals, because only the STRICTLY richer ones were
   * counted, and it told a reader holding the league maximum that the richest
   * rival had "only" that same maximum and could not compete.
   */
  it("calls a league where nobody has spent anything level, not broke", () => {
    const { read, signals } = buildMarket(
      baseInput({
        yourBudget: 100,
        rivalBudgets: [100, 100, 100, 100, 100],
        leagueTotalBudget: 100,
      }),
    );
    expect(read.rivalsRicher).toBe(0);
    expect(read.rivalsAtLeastAsRich).toBe(5);
    expect(read.everyoneAtFullBudget).toBe(true);

    const signal = signals.find((s) => s.id === "rival-budget");
    expect(signal?.tone).toBe("neutral");
    expect(signal?.multiplier).toBe(1);
    expect(signal?.detail).not.toMatch(/only/i);
    expect(signal?.label).not.toMatch(/broke/i);
  });

  it("does not discount when rivals merely tie you below full budget", () => {
    const { read, signals } = buildMarket(
      baseInput({ yourBudget: 40, rivalBudgets: [40, 40, 40], leagueTotalBudget: 100 }),
    );
    expect(read.everyoneAtFullBudget).toBe(false);
    const signal = signals.find((s) => s.id === "rival-budget");
    expect(signal?.tone).toBe("neutral");
    expect(signal?.multiplier).toBe(1);
  });

  it("never claims rivals are short when one of them can outbid you", () => {
    const { signals } = buildMarket(
      baseInput({ yourBudget: 50, rivalBudgets: [50, 50, 90, 10, 10] }),
    );
    const signal = signals.find((s) => s.id === "rival-budget");
    expect(signal?.label).not.toMatch(/short of money/i);
  });
});

describe("rival need", () => {
  it("treats an uncontested add as a bargain", () => {
    const { signals } = buildMarket(baseInput({ interestedRivals: 0, rivalsChecked: 11 }));
    const signal = signals.find((s) => s.id === "rival-need");
    expect(signal?.tone).toBe("good");
    expect(signal?.multiplier).toBeLessThan(1);
  });

  it("raises the price when several rivals would start him", () => {
    const { signals } = buildMarket(baseInput({ interestedRivals: 5, rivalsChecked: 11 }));
    const signal = signals.find((s) => s.id === "rival-need");
    expect(signal?.tone).toBe("bad");
    expect(signal?.multiplier).toBeGreaterThan(1);
  });

  it("stays silent when we could not check", () => {
    const { signals } = buildMarket(
      baseInput({ interestedRivals: null, rivalsChecked: null }),
    );
    expect(signals.find((s) => s.id === "rival-need")).toBeUndefined();
  });
});

describe("urgency", () => {
  it("discounts early and boosts late", () => {
    const early = urgencyMultiplier(baseInput({ currentWeek: 2 }));
    const late = urgencyMultiplier(baseInput({ currentWeek: 13 }));
    expect(early).toBeLessThan(1);
    expect(late).toBeGreaterThan(1);
  });

  it("ramps monotonically between the two anchors", () => {
    const values = [4, 6, 8, 10, 11].map((week) =>
      urgencyMultiplier(baseInput({ currentWeek: week })),
    );
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it("can be switched off entirely", () => {
    const settings = structuredClone(DEFAULT_FAAB_SETTINGS.market);
    settings.urgency.enabled = false;
    expect(urgencyMultiplier(baseInput({ currentWeek: 14, settings }))).toBe(1);
  });
});

describe("market read", () => {
  it("reports weeks left and the richest rival", () => {
    const { read } = buildMarket(
      baseInput({ currentWeek: 10, lastRegularWeek: 14, rivalBudgets: [12, 40, 7] }),
    );
    expect(read.weeksLeft).toBe(5);
    expect(read.richestRivalBudget).toBe(40);
    expect(read.medianRivalBudget).toBe(12);
  });

  it("reports no rival budgets when the league publishes none", () => {
    const { read, signals } = buildMarket(baseInput({ rivalBudgets: [] }));
    expect(read.richestRivalBudget).toBeNull();
    expect(signals.find((s) => s.id === "rival-budget")).toBeUndefined();
  });
});
