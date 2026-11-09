import { describe, expect, it } from "vitest";
import { DEFAULT_LONG_SHOT_SETTINGS } from "./default-settings";
import { assignTiers, assignTiersBanded } from "./tiers";

const { bands, cutoffs } = DEFAULT_LONG_SHOT_SETTINGS.tiers;
const entry = (player_id: string, rate: number) => ({ player_id, rate });

describe("assignTiersBanded", () => {
  it("reads each answer against the absolute bands", () => {
    const out = assignTiersBanded([entry("a", 0.01), entry("b", 0.05), entry("c", 0.2), entry("d", 0.5), entry("e", 0.9)], bands, cutoffs);
    expect(out.map((e) => e.tier)).toEqual(["long_shot", "sleeper", "deep", "field", "chalk"]);
  });

  it("never makes a player rostered everywhere a Long Shot", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => entry(`p${i}`, 0.6 + i * 0.008));
    const out = assignTiersBanded(fifty, bands, cutoffs);
    expect(out.some((e) => e.tier === "long_shot" || e.tier === "sleeper")).toBe(false);
    // One band, so spread across chalk, field and deep by percentile.
    expect(new Set(out.map((e) => e.tier))).toEqual(new Set(["chalk", "field", "deep"]));
    expect(out[0].tier).toBe("deep");
    expect(out[out.length - 1].tier).toBe("chalk");
  });

  it("keeps a one-band set of Long Shots all Long Shots", () => {
    const out = assignTiersBanded([entry("a", 0), entry("b", 0.01), entry("c", 0.015)], bands, cutoffs);
    expect(out.every((e) => e.tier === "long_shot")).toBe(true);
  });

  it("returns [] for an empty set", () => {
    expect(assignTiersBanded([], bands, cutoffs)).toEqual([]);
  });
});

describe("assignTiers (percentile)", () => {
  it("gives equal rates equal tiers", () => {
    const out = assignTiers([entry("a", 0), entry("b", 0), entry("c", 0.5), entry("d", 0.9)], cutoffs);
    expect(out[0].tier).toBe(out[1].tier);
  });
});
