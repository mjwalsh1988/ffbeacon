import { describe, it, expect } from "vitest";
import { validateFaabSettings } from "./settings";
import { DEFAULT_FAAB_SETTINGS } from "./default-settings";

describe("validateFaabSettings", () => {
  it("accepts the shipped defaults", () => {
    const res = validateFaabSettings(DEFAULT_FAAB_SETTINGS);
    expect(res.ok).toBe(true);
  });

  it("fills missing groups from defaults (partial input)", () => {
    const res = validateFaabSettings({});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.settings.bidCurve.length).toBe(DEFAULT_FAAB_SETTINGS.bidCurve.length);
      expect(res.settings.userDefaults.defaultTeams).toBe(12);
    }
  });

  it("rejects a bid curve with a gap (non-contiguous bands)", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    // Introduce a gap: second band starts above where the first ends.
    broken.bidCurve[1].minRatio = 0.5; // first band ends at 0.35
    const res = validateFaabSettings(broken);
    expect(res.ok).toBe(false);
  });

  it("rejects a bid curve that does not start at 0", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    broken.bidCurve[0].minRatio = 0.1;
    const res = validateFaabSettings(broken);
    expect(res.ok).toBe(false);
  });

  it("rejects a bid curve with no open-ended final band", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    broken.bidCurve[broken.bidCurve.length - 1].maxRatio = 5;
    const res = validateFaabSettings(broken);
    expect(res.ok).toBe(false);
  });

  it("rejects wrong types", () => {
    const res = validateFaabSettings({ needMultipliers: { low: "nope" } });
    expect(res.ok).toBe(false);
  });

  it("keeps a stored row that predates the new groups, filling them from defaults", () => {
    const old = structuredClone(DEFAULT_FAAB_SETTINGS) as unknown as Record<string, unknown>;
    delete old.auction;
    delete old.goal;
    delete old.chopped;
    delete old.priors;
    const res = validateFaabSettings(old);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.settings.auction.runs).toBe(DEFAULT_FAAB_SETTINGS.auction.runs);
      expect(res.settings.chopped.strengthWeights.surviveThisWeek).toBe(0.4);
    }
  });
});

describe("calendar bands", () => {
  it("rejects a gap between bands", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    broken.market.calendar.bands[1].fromWeek = 3;
    expect(validateFaabSettings(broken).ok).toBe(false);
  });

  it("rejects a first band that does not start at week 1", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    broken.market.calendar.bands[0].fromWeek = 2;
    expect(validateFaabSettings(broken).ok).toBe(false);
  });

  it("rejects a closed final band, which would leave the end of the season unpriced", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    broken.market.calendar.bands[broken.market.calendar.bands.length - 1].toWeek = 17;
    expect(validateFaabSettings(broken).ok).toBe(false);
  });
});

describe("goals", () => {
  it("rejects a value target at or above the sure target", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    broken.goal.valueTarget = 0.95;
    expect(validateFaabSettings(broken).ok).toBe(false);
  });
});

describe("auction clamps", () => {
  it("rejects a clamp whose lower bound is not below its upper", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    broken.auction.heatClamp = [2.5, 0.5];
    expect(validateFaabSettings(broken).ok).toBe(false);
  });
});

describe("chopped settings", () => {
  it("rejects strength weights that do not sum to 1", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    broken.chopped.strengthWeights.winLeague = 0.6;
    expect(validateFaabSettings(broken).ok).toBe(false);
  });

  it("accepts weights within the rounding tolerance", () => {
    const ok = structuredClone(DEFAULT_FAAB_SETTINGS);
    ok.chopped.strengthWeights = { surviveThisWeek: 0.333, winLeague: 0.333, weeksAlive: 0.334 };
    expect(validateFaabSettings(ok).ok).toBe(true);
  });

  it("rejects alive-fraction bands that are not ordered high to low", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    broken.chopped.priceByAliveFraction = [
      { minFraction: 0, multiplier: 0.15 },
      { minFraction: 0.5, multiplier: 1 },
    ];
    expect(validateFaabSettings(broken).ok).toBe(false);
  });

  it("rejects alive-fraction bands that do not reach 0", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    broken.chopped.priceByAliveFraction = [
      { minFraction: 0.5, multiplier: 1 },
      { minFraction: 0.3, multiplier: 0.45 },
    ];
    expect(validateFaabSettings(broken).ok).toBe(false);
  });

  it("rejects pace targets out of week order", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    broken.chopped.paceTargets = [
      { throughWeek: 8, holdPct: 75 },
      { throughWeek: 4, holdPct: 90 },
    ];
    expect(validateFaabSettings(broken).ok).toBe(false);
  });
});

describe("manual season end", () => {
  it("accepts a 17-week regular season", () => {
    const ok = structuredClone(DEFAULT_FAAB_SETTINGS);
    ok.userDefaults.defaultLastRegularWeek = 17;
    expect(validateFaabSettings(ok).ok).toBe(true);
  });

  it("rejects a season that ends before week 10", () => {
    const broken = structuredClone(DEFAULT_FAAB_SETTINGS);
    broken.userDefaults.defaultLastRegularWeek = 4;
    expect(validateFaabSettings(broken).ok).toBe(false);
  });
});
