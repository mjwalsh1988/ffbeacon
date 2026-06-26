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
});
