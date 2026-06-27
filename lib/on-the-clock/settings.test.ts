import { describe, it, expect } from "vitest";
import { validateOnTheClockSettings, clampOnTheClockSettings } from "./settings";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "./default-settings";

describe("validateOnTheClockSettings", () => {
  it("accepts the shipped defaults", () => {
    const res = validateOnTheClockSettings(DEFAULT_ON_THE_CLOCK_SETTINGS);
    expect(res.ok).toBe(true);
  });

  it("fills missing groups from defaults (empty input)", () => {
    const res = validateOnTheClockSettings({});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.settings.sync.cooldownSeconds).toBe(30);
      expect(res.settings.feature.enabled).toBe(false);
      expect(res.settings.recommendation.weights.value).toBe(0.6);
      expect(res.settings.pools.enabledPools).toContain("everyone");
    }
  });

  it("merges a partial override onto defaults", () => {
    const res = validateOnTheClockSettings({ sync: { cooldownSeconds: 45 } });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.settings.sync.cooldownSeconds).toBe(45);
      // untouched fields still come from defaults
      expect(res.settings.sync.lockSeconds).toBe(15);
      expect(res.settings.sync.realtimeEnabled).toBe(true);
    }
  });

  it("rejects lockSeconds greater than cooldownSeconds", () => {
    const res = validateOnTheClockSettings({ sync: { cooldownSeconds: 10, lockSeconds: 20 } });
    expect(res.ok).toBe(false);
  });

  it("rejects a defaultPool not in enabledPools", () => {
    const res = validateOnTheClockSettings({
      pools: { enabledPools: ["everyone"], defaultPool: "rookies" },
    });
    expect(res.ok).toBe(false);
  });

  it("rejects wrong types", () => {
    const res = validateOnTheClockSettings({ sync: { cooldownSeconds: "soon" } });
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown aggressiveness preset", () => {
    const res = validateOnTheClockSettings({ recommendation: { aggressiveness: "reckless" } });
    expect(res.ok).toBe(false);
  });

  it("preserves wired-but-unexposed keys through a round-trip", () => {
    // pools / maxAvailablePlayers / mappingVisibility have no admin control yet, but
    // they are in the schema and must survive a save unchanged.
    const custom = structuredClone(DEFAULT_ON_THE_CLOCK_SETTINGS);
    custom.pools.enabledPools = ["everyone"];
    custom.pools.defaultPool = "everyone";
    custom.limits.maxAvailablePlayers = 250;
    custom.mappingVisibility.showUnmappedPanel = false;
    const res = validateOnTheClockSettings(custom);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.settings.pools.enabledPools).toEqual(["everyone"]);
      expect(res.settings.limits.maxAvailablePlayers).toBe(250);
      expect(res.settings.mappingVisibility.showUnmappedPanel).toBe(false);
    }
  });
});

describe("clampOnTheClockSettings", () => {
  it("leaves the shipped defaults unchanged", () => {
    const out = clampOnTheClockSettings(DEFAULT_ON_THE_CLOCK_SETTINGS);
    expect(out.sync.cooldownSeconds).toBe(DEFAULT_ON_THE_CLOCK_SETTINGS.sync.cooldownSeconds);
    expect(out.recommendation.weights.value).toBe(
      DEFAULT_ON_THE_CLOCK_SETTINGS.recommendation.weights.value,
    );
    // The clamped output must still pass full validation.
    expect(validateOnTheClockSettings(out).ok).toBe(true);
  });

  it("raises a too-low cooldown to the safe minimum", () => {
    const s = structuredClone(DEFAULT_ON_THE_CLOCK_SETTINGS);
    s.sync.cooldownSeconds = 0;
    const out = clampOnTheClockSettings(s);
    expect(out.sync.cooldownSeconds).toBe(5);
  });

  it("clamps lockSeconds to never exceed the cooldown", () => {
    const s = structuredClone(DEFAULT_ON_THE_CLOCK_SETTINGS);
    s.sync.cooldownSeconds = 10;
    s.sync.lockSeconds = 99;
    const out = clampOnTheClockSettings(s);
    expect(out.sync.lockSeconds).toBeLessThanOrEqual(out.sync.cooldownSeconds);
    expect(out.sync.lockSeconds).toBe(10);
    // The result of clamping a previously-invalid pair must now validate.
    expect(validateOnTheClockSettings(out).ok).toBe(true);
  });

  it("clamps a negative weight up to zero and a huge board cap down", () => {
    const s = structuredClone(DEFAULT_ON_THE_CLOCK_SETTINGS);
    s.recommendation.weights.need = -5;
    s.limits.maxAvailablePlayers = 999999;
    const out = clampOnTheClockSettings(s);
    expect(out.recommendation.weights.need).toBe(0);
    expect(out.limits.maxAvailablePlayers).toBe(2000);
  });

  it("clamps an out-of-range superflex multiplier into the safe band", () => {
    const s = structuredClone(DEFAULT_ON_THE_CLOCK_SETTINGS);
    s.positionAdjust.superflexQbMultiplier = 50;
    const out = clampOnTheClockSettings(s);
    expect(out.positionAdjust.superflexQbMultiplier).toBe(5);
  });
});
