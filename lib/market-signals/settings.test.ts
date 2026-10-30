import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKET_SIGNAL_SETTINGS,
  mergeMarketSignalSettings,
  validateMarketSignalSettings,
} from "./settings";

describe("market signal settings", () => {
  it("defaults match plan 5.8", () => {
    expect(validateMarketSignalSettings({})).toEqual({
      ok: true,
      settings: {
        windowDays: 30,
        k: 2,
        watchPct: 0.05,
        holdBackPct: 0.1,
        minPoints: 24,
        staleDays: 3,
        lookbackDays: 45,
        floorPct: 0.05,
        enabled: true,
        modelVersion: 1,
      },
    });
  });

  it.each([
    [{ windowDays: 9 }],
    [{ windowDays: 91 }],
    [{ k: 0.5 }],
    [{ k: 3.5 }],
    [{ watchPct: 0.3 }],
    [{ holdBackPct: 0.4 }],
    [{ minPoints: 4 }],
    [{ staleDays: 8 }],
    [{ floorPct: 0.25 }],
  ])("rejects out of bounds %j", (raw) => {
    expect(validateMarketSignalSettings(raw).ok).toBe(false);
  });

  it("rejects min points above the window", () => {
    expect(validateMarketSignalSettings({ windowDays: 20, minPoints: 24 }).ok).toBe(false);
  });

  it("rejects a lookback shorter than the window", () => {
    expect(validateMarketSignalSettings({ windowDays: 30, lookbackDays: 20 }).ok).toBe(false);
  });

  it("merges a partial row and falls back on a corrupt one", () => {
    expect(mergeMarketSignalSettings({ k: 2.5 }).k).toBe(2.5);
    expect(mergeMarketSignalSettings({ k: "two" })).toBe(DEFAULT_MARKET_SIGNAL_SETTINGS);
  });
});
