import { describe, expect, it } from "vitest";
import {
  classifySignal,
  collapseToDays,
  computeBands,
  computeSignal,
  isLoggedChange,
  marketValueOf,
  rollingBands,
  signalSince,
  type Bands,
} from "./bollinger";
import { DEFAULT_MARKET_SIGNAL_SETTINGS as S } from "./default-settings";
import { END_DAY, breakoutSeries, gappySeries, steadySeries } from "./__fixtures__/series";

const bandsAround = (mean: number, halfWidth: number): Bands => ({
  n: 30,
  mean,
  stdev: halfWidth / 2,
  upper: mean + halfWidth,
  lower: mean - halfWidth,
  width: 2 * halfWidth,
});

describe("computeBands", () => {
  it("matches hand-computed mean and sample stdev for 1..30", () => {
    const values = Array.from({ length: 30 }, (_, i) => i + 1);
    const b = computeBands(values, 2);
    expect(b.mean).toBe(15.5);
    // sum((i - 15.5)^2) for 1..30 = 2247.5; / 29 = 77.5
    expect(b.stdev).toBeCloseTo(Math.sqrt(77.5), 10);
    expect(b.upper).toBeCloseTo(15.5 + 2 * Math.sqrt(77.5), 10);
    expect(b.lower).toBeCloseTo(15.5 - 2 * Math.sqrt(77.5), 10);
  });

  it("returns a zero-width band for a flat series", () => {
    expect(computeBands([5, 5, 5], 2).width).toBe(0);
  });

  it("has no stdev under two points", () => {
    expect(computeBands([5], 2).stdev).toBeNull();
  });
});

describe("collapseToDays", () => {
  it("keeps the latest captured_at of a day", () => {
    const series = collapseToDays([
      { value: 100, formula_offset: null, captured_at: "2026-10-01T12:00:00Z" },
      { value: 120, formula_offset: null, captured_at: "2026-10-01T09:30:00Z" },
      { value: 130, formula_offset: null, captured_at: "2026-10-01T22:00:00Z" },
      { value: 90, formula_offset: null, captured_at: "2026-10-02T09:00:00Z" },
    ]);
    expect([...series]).toEqual([
      ["2026-10-01", 130],
      ["2026-10-02", 90],
    ]);
  });

  it("measures value minus formula_offset", () => {
    expect(marketValueOf({ value: 5000, formula_offset: 250 })).toBe(4750);
    const series = collapseToDays([
      { value: 5000, formula_offset: 250, captured_at: "2026-10-01T09:00:00Z" },
    ]);
    expect(series.get("2026-10-01")).toBe(4750);
  });
});

describe("classifySignal", () => {
  const base = { points: 30, prev: null, thin: false, settings: S };
  const b = bandsAround(1000, 100); // lower 900, upper 1100, width 200

  it("labels each zone with inclusive boundaries", () => {
    expect(classifySignal({ ...base, latest: 1100, bands: b })).toBe("sell");
    expect(classifySignal({ ...base, latest: 1090, bands: b })).toBe("watch_sell");
    expect(classifySignal({ ...base, latest: 1000, bands: b })).toBe("hold");
    expect(classifySignal({ ...base, latest: 910, bands: b })).toBe("watch_buy");
    expect(classifySignal({ ...base, latest: 900, bands: b })).toBe("buy");
  });

  it("is baseline under min points or with a zero width", () => {
    expect(classifySignal({ ...base, points: 23, latest: 1200, bands: b })).toBe("baseline");
    expect(classifySignal({ ...base, latest: 5, bands: { ...b, width: 0 } })).toBe("baseline");
  });

  it("is thin under the floor whatever the band says", () => {
    expect(classifySignal({ ...base, thin: true, latest: 1200, bands: b })).toBe("thin");
  });

  it("keeps sell when re-entering by less than hold back, drops to hold by more", () => {
    // hold back 10% of 200 = 20, so sell holds down to 1080.
    expect(classifySignal({ ...base, prev: "sell", latest: 1085, bands: b })).toBe("sell");
    expect(classifySignal({ ...base, prev: "sell", latest: 1075, bands: b })).toBe("hold");
  });

  it("keeps buy symmetrically", () => {
    expect(classifySignal({ ...base, prev: "buy", latest: 915, bands: b })).toBe("buy");
    expect(classifySignal({ ...base, prev: "buy", latest: 925, bands: b })).toBe("hold");
  });

  it("does not hold a sell from a non-sell previous state", () => {
    expect(classifySignal({ ...base, prev: "hold", latest: 1085, bands: b })).toBe("hold");
  });
});

describe("computeSignal", () => {
  const input = { runDay: END_DAY, prev: null, topMarketValue: 9000, settings: S };

  it("holds a steady series in the middle of its band", () => {
    const row = computeSignal({ ...input, series: steadySeries })!;
    expect(row.signal).toBe("hold");
    expect(row.points).toBe(30);
    // The window's mean is 1004.8, so 1005 sits just above the middle.
    expect(row.bandPct).toBeCloseTo(0.5, 1);
  });

  it("calls sell on a breakout above the band", () => {
    const row = computeSignal({ ...input, series: breakoutSeries })!;
    expect(row.signal).toBe("sell");
    expect(row.bandPct!).toBeGreaterThan(1);
  });

  it("is baseline with 20 of 30 points but still stores bands", () => {
    const row = computeSignal({ ...input, series: gappySeries })!;
    expect(row.points).toBe(20);
    expect(row.signal).toBe("baseline");
    expect(row.upper).not.toBeNull();
  });

  it("writes nothing for a stale series", () => {
    expect(computeSignal({ ...input, runDay: "2026-11-05", series: steadySeries })).toBeNull();
  });

  it("is thin under 5% of the partition top", () => {
    const row = computeSignal({ ...input, topMarketValue: 30_000, series: steadySeries })!;
    expect(row.signal).toBe("thin");
  });
});

describe("change log rules", () => {
  it("logs only a change into a call state", () => {
    expect(isLoggedChange("hold", "sell")).toBe(true);
    expect(isLoggedChange(null, "hold")).toBe(true);
    expect(isLoggedChange("sell", "sell")).toBe(false);
    expect(isLoggedChange("hold", "baseline")).toBe(false);
    expect(isLoggedChange("hold", "thin")).toBe(false);
  });

  it("carries signal_since while unchanged", () => {
    expect(signalSince("buy", "2026-10-03", "buy", END_DAY)).toBe("2026-10-03");
    expect(signalSince("hold", "2026-10-03", "buy", END_DAY)).toBe(END_DAY);
  });
});

describe("rollingBands", () => {
  it("ends on the same band the cron writes", () => {
    const rows = rollingBands(breakoutSeries, S);
    const last = rows[rows.length - 1];
    const cron = computeSignal({
      series: breakoutSeries,
      runDay: END_DAY,
      prev: null,
      topMarketValue: 9000,
      settings: S,
    })!;
    expect(last.day).toBe(END_DAY);
    expect(last.upper).toBe(cron.upper);
    expect(last.lower).toBe(cron.lower);
  });

  it("starts once min points exist", () => {
    expect(rollingBands(steadySeries, S)).toHaveLength(30 - S.minPoints + 1);
  });
});
