import { describe, it, expect } from "vitest";
import {
  pickOverridesFor,
  applyPickOverrides,
  type ManualSignalRow,
  type PickKey,
} from "./manual";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const KEY: PickKey = {
  season: 2027,
  round: 3,
  position: "mid",
  formatConfigId: "fmt-sflex",
};

function signal(over: Partial<ManualSignalRow> = {}): ManualSignalRow {
  return {
    id: "s1",
    target: "pick",
    playerId: null,
    pickSeason: 2027,
    pickRound: 3,
    pickPosition: null,
    formatConfigId: null,
    adjustmentType: "multiplier",
    magnitude: 0.9,
    silent: false,
    decayDays: null,
    createdAtMs: NOW,
    ...over,
  };
}

describe("pickOverridesFor", () => {
  it("matches a whole round when no slot is named", () => {
    const s = [signal()];
    for (const position of ["early", "mid", "late"]) {
      expect(pickOverridesFor(s, { ...KEY, position }, NOW)).toHaveLength(1);
    }
  });

  it("matches only the named slot", () => {
    const s = [signal({ pickPosition: "early" })];
    expect(pickOverridesFor(s, { ...KEY, position: "early" }, NOW)).toHaveLength(1);
    expect(pickOverridesFor(s, { ...KEY, position: "mid" }, NOW)).toHaveLength(0);
  });

  it("ignores a different season or round", () => {
    const s = [signal()];
    expect(pickOverridesFor(s, { ...KEY, season: 2028 }, NOW)).toHaveLength(0);
    expect(pickOverridesFor(s, { ...KEY, round: 2 }, NOW)).toHaveLength(0);
  });

  it("applies to every format when no format is named, and only one when named", () => {
    expect(pickOverridesFor([signal()], { ...KEY, formatConfigId: "fmt-other" }, NOW)).toHaveLength(1);
    const scoped = [signal({ formatConfigId: "fmt-sflex" })];
    expect(pickOverridesFor(scoped, KEY, NOW)).toHaveLength(1);
    expect(pickOverridesFor(scoped, { ...KEY, formatConfigId: "fmt-other" }, NOW)).toHaveLength(0);
  });

  it("never picks up a player signal", () => {
    const s = [signal({ target: "player", playerId: "p1", pickSeason: null, pickRound: null })];
    expect(pickOverridesFor(s, KEY, NOW)).toHaveLength(0);
  });

  it("fades a multiplier toward 1.0 across its decay window", () => {
    const s = [signal({ magnitude: 0.8, decayDays: 10, createdAtMs: NOW - 5 * DAY })];
    const [o] = pickOverridesFor(s, KEY, NOW);
    expect(o.magnitude).toBeCloseTo(0.9, 10); // halfway between 0.8 and 1.0
  });
});

describe("applyPickOverrides", () => {
  it("returns the base untouched when nothing matches", () => {
    expect(applyPickOverrides(4200, [])).toBe(4200);
  });

  it("stacks multipliers on top of the already-multiplied base", () => {
    // base 5000 has already been through the global pick_value_multiplier
    const value = applyPickOverrides(5000, [
      { type: "multiplier", magnitude: 0.9, silent: false },
      { type: "multiplier", magnitude: 0.5, silent: false },
    ]);
    expect(value).toBe(2250);
  });

  it("adds deltas and rounds to a whole number", () => {
    expect(applyPickOverrides(1000, [{ type: "delta", magnitude: -250.4, silent: false }])).toBe(750);
  });

  it("never goes below zero", () => {
    expect(applyPickOverrides(100, [{ type: "delta", magnitude: -500, silent: false }])).toBe(0);
  });

  it("lets a set_value short-circuit everything before it", () => {
    const value = applyPickOverrides(5000, [
      { type: "multiplier", magnitude: 0.5, silent: false },
      { type: "set_value", magnitude: 1234, silent: false },
    ]);
    expect(value).toBe(1234);
  });
});
