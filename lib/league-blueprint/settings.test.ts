import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAGUE_BLUEPRINT_SETTINGS,
  mergeLeagueBlueprintSettings,
  validateLeagueBlueprintSettings,
} from "./settings";

const d = DEFAULT_LEAGUE_BLUEPRINT_SETTINGS;

describe("league blueprint settings", () => {
  it("fills an empty document with the code defaults", () => {
    const result = validateLeagueBlueprintSettings({});
    expect(result).toEqual({ ok: true, settings: d });
  });

  it("keeps the owner's sell cutoffs as defaults", () => {
    expect(d.calls.ageCutoff).toEqual({ QB: 33, RB: 28, WR: 30, TE: 30 });
  });

  it("fills a partial older row field by field", () => {
    const merged = mergeLeagueBlueprintSettings({ version: 4, calls: { needMinPoints: 2 } });
    expect(merged.version).toBe(4);
    expect(merged.calls.needMinPoints).toBe(2);
    expect(merged.calls.ageCutoff.RB).toBe(28);
    expect(merged.activity).toEqual(d.activity);
  });

  it("rejects a weight outside 0 to 1", () => {
    const result = validateLeagueBlueprintSettings({ grades: { valueWeight: 1.5 } });
    expect(result.ok).toBe(false);
  });

  it("rejects activity weights that do not sum to 1", () => {
    const result = validateLeagueBlueprintSettings({
      activity: { sellWeight: 0.5, needWeight: 0.3, divergenceWeight: 0.3 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sum to 1/);
  });

  it("accepts weights that sum to 1 within 0.001", () => {
    const result = validateLeagueBlueprintSettings({
      activity: { sellWeight: 0.3334, needWeight: 0.3333, divergenceWeight: 0.3333 },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects lowBelow at or above highAbove", () => {
    const result = validateLeagueBlueprintSettings({ activity: { lowBelow: 70 } });
    expect(result.ok).toBe(false);
  });

  it("rejects an age cutoff outside 20 to 45", () => {
    expect(validateLeagueBlueprintSettings({ calls: { ageCutoff: { RB: 19 } } }).ok).toBe(false);
    expect(validateLeagueBlueprintSettings({ calls: { ageCutoff: { QB: 46 } } }).ok).toBe(false);
  });

  it("rejects a non-positive overall weight", () => {
    expect(validateLeagueBlueprintSettings({ grades: { overall: { te: 0 } } }).ok).toBe(false);
  });

  it("falls back to defaults on a corrupt row", () => {
    expect(mergeLeagueBlueprintSettings({ version: "nine" })).toBe(d);
    expect(mergeLeagueBlueprintSettings(null)).toEqual(d);
  });
});
