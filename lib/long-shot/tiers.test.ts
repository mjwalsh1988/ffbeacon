import { describe, expect, it } from "vitest";
import { DEFAULT_LONG_SHOT_SETTINGS } from "./default-settings";
import { assignTiers, pointsFor } from "./tiers";

const cutoffs = DEFAULT_LONG_SHOT_SETTINGS.tiers.cutoffs;
const points = DEFAULT_LONG_SHOT_SETTINGS.tiers.points;

describe("assignTiers", () => {
  it("splits 20 distinct rates 10/25/50/75", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      player_id: `p${String(i).padStart(2, "0")}`,
      rate: i / 20,
    }));
    const tiers = assignTiers(entries, cutoffs).map((e) => e.tier);
    expect(tiers.filter((t) => t === "long_shot")).toHaveLength(2);
    expect(tiers.filter((t) => t === "sleeper")).toHaveLength(3);
    expect(tiers.filter((t) => t === "deep")).toHaveLength(5);
    expect(tiers.filter((t) => t === "field")).toHaveLength(5);
    expect(tiers.filter((t) => t === "chalk")).toHaveLength(5);
  });

  it("ties on rate share a tier", () => {
    const entries = [
      { player_id: "a", rate: 0.1 },
      { player_id: "b", rate: 0.2 },
      { player_id: "c", rate: 0.2 },
      { player_id: "d", rate: 0.2 },
      { player_id: "e", rate: 0.9 },
    ];
    const out = assignTiers(entries, cutoffs);
    const byId = Object.fromEntries(out.map((e) => [e.player_id, e.tier]));
    expect(byId.b).toBe(byId.c);
    expect(byId.c).toBe(byId.d);
  });

  it("a set of 8 where every rate is 0 is all long_shot", () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({ player_id: `p${i}`, rate: 0 }));
    expect(assignTiers(entries, cutoffs).every((e) => e.tier === "long_shot")).toBe(true);
  });

  it("respects cutoffs from settings", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ player_id: `p${i}`, rate: i }));
    const wide = { long_shot: 0.5, sleeper: 0.6, deep: 0.7, field: 0.8 };
    expect(assignTiers(entries, wide).filter((e) => e.tier === "long_shot")).toHaveLength(5);
  });

  it("sorts by rate then player id for a stable order", () => {
    const out = assignTiers(
      [
        { player_id: "z", rate: 0.5 },
        { player_id: "a", rate: 0.5 },
        { player_id: "m", rate: 0.1 },
      ],
      cutoffs,
    );
    expect(out.map((e) => e.player_id)).toEqual(["m", "a", "z"]);
  });
});

describe("pointsFor", () => {
  it("maps a tier to its points and null to 0", () => {
    expect(pointsFor("long_shot", points)).toBe(100);
    expect(pointsFor(null, points)).toBe(0);
  });
});
