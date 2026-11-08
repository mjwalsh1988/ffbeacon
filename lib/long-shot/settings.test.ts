import { describe, expect, it } from "vitest";
import { DEFAULT_LONG_SHOT_SETTINGS } from "./default-settings";
import {
  clampLongShotSettings,
  mergeLongShotSettings,
  validateLongShotSettings,
} from "./settings";

describe("validateLongShotSettings", () => {
  it("fills an empty document with the defaults", () => {
    const r = validateLongShotSettings({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings).toEqual(DEFAULT_LONG_SHOT_SETTINGS);
  });

  it("strips unknown keys", () => {
    const r = validateLongShotSettings({ surprise: 1, timer: { seconds: 40, extra: true } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings).not.toHaveProperty("surprise");
      expect(r.settings.timer).toEqual({ seconds: 40, grace_seconds: 2 });
    }
  });

  it("rejects a timer outside 10..120", () => {
    expect(validateLongShotSettings({ timer: { seconds: 5 } }).ok).toBe(false);
    expect(validateLongShotSettings({ timer: { seconds: 121 } }).ok).toBe(false);
  });

  it("rejects cutoffs that are not strictly increasing", () => {
    const r = validateLongShotSettings({
      tiers: { cutoffs: { long_shot: 0.3, sleeper: 0.25, deep: 0.5, field: 0.75 } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cutoffs/);
  });

  it("rejects points that are not strictly increasing", () => {
    const r = validateLongShotSettings({
      tiers: { points: { chalk: 10, field: 10, deep: 60, sleeper: 85, long_shot: 100 } },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects max_answers below min_answers", () => {
    const r = validateLongShotSettings({
      templates: { game_line: { min_answers: 20, max_answers: 10 } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/game_line/);
  });

  it("rejects a wrong type", () => {
    expect(validateLongShotSettings({ game_enabled: "yes" }).ok).toBe(false);
  });
});

describe("mergeLongShotSettings and clamp", () => {
  it("falls back to defaults on a corrupt row", () => {
    expect(mergeLongShotSettings({ timer: "nope" })).toEqual(DEFAULT_LONG_SHOT_SETTINGS);
  });

  it("clamp pulls numbers back inside their bounds and repairs a broken ramp", () => {
    const raw = structuredClone(DEFAULT_LONG_SHOT_SETTINGS);
    raw.timer.seconds = 999;
    raw.tiers.points.field = 5;
    const out = clampLongShotSettings(raw);
    expect(out.timer.seconds).toBe(120);
    expect(out.tiers.points).toEqual(DEFAULT_LONG_SHOT_SETTINGS.tiers.points);
  });
});
