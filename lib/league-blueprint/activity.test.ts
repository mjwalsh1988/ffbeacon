import { describe, expect, it } from "vitest";
import { activityBand, computeActivity, largestRemainderPercents, type ActivityInput } from "./activity";
import { DEFAULT_LEAGUE_BLUEPRINT_SETTINGS } from "./default-settings";
import type { PlayerCall } from "./types";

const s = DEFAULT_LEAGUE_BLUEPRINT_SETTINGS.activity;
const call = (c: PlayerCall["call"]): PlayerCall => ({ call: c, strength: c === "sell" ? "soft" : null, note: null });

const base = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  calls: { a: call("sell"), b: call("cut"), c: call("build"), d: call("hold") },
  needPositions: ["RB"],
  rankDivergence: 0,
  valueRank: 3,
  pulseRank: 3,
  teamCount: 12,
  buys: [],
  settings: s,
  ...over,
});

describe("computeActivity", () => {
  it("applies the formula", () => {
    // 100 * (0.4 * 0.5 + 0.3 * 0.25 + 0.3 * 0) = 27.5 -> 28
    const a = computeActivity(base());
    expect(a.score).toBe(28);
    expect(a.band).toBe("Low");
    // Sell and Cut counted apart.
    expect([a.sellsPct, a.cutsPct, a.buildsPct, a.holdsPct]).toEqual([25, 25, 25, 25]);
    expect([a.sellCount, a.cutCount]).toEqual([1, 1]);
  });

  it("rounds the split to exactly 100 by largest remainder", () => {
    // Three of a kind: 33.3 each, the leftover point to the first.
    const a = computeActivity(base({ calls: { a: call("sell"), c: call("build"), d: call("hold") } }));
    expect([a.sellsPct, a.cutsPct, a.buildsPct, a.holdsPct]).toEqual([34, 0, 33, 33]);
    expect(largestRemainderPercents([1, 1, 1, 4])).toEqual([15, 14, 14, 57]);
    expect(largestRemainderPercents([2, 1, 0, 4]).reduce((x, y) => x + y, 0)).toBe(100);
    expect(largestRemainderPercents([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
  });

  it("caps divergence at half the league", () => {
    // divergence 12 over 6 clamps to 1: 100 * (0.2 + 0 + 0.3) = 50
    expect(computeActivity(base({ rankDivergence: -12, needPositions: [] })).score).toBe(50);
  });

  it("bands at 34 and 66", () => {
    expect(activityBand(33, s)).toBe("Low");
    expect(activityBand(34, s)).toBe("Moderate");
    expect(activityBand(66, s)).toBe("Moderate");
    expect(activityBand(67, s)).toBe("High");
  });

  it("names the largest term in the driver sentence", () => {
    expect(computeActivity(base()).driver).toBe("Driven by 1 player to sell and 1 to cut.");
    expect(computeActivity(base({ calls: { a: call("sell"), b: call("sell") } })).driver).toBe(
      "Driven by 2 players to sell.",
    );
    expect(
      computeActivity(base({ calls: { d: call("hold") }, needPositions: ["RB", "TE"] })).driver,
    ).toBe("Driven by needs at RB and TE.");
    expect(
      computeActivity(
        base({ calls: { d: call("hold") }, needPositions: [], rankDivergence: -6, valueRank: 3, pulseRank: 9 }),
      ).driver,
    ).toBe("Driven by the gap between 3rd of 12 in value and 9th of 12 in Power Pulse.");
  });

  it("counts buy targets apart from the roster shares", () => {
    const a = computeActivity(
      base({
        buys: [
          { position: "RB", need: 2, targets: [{} as never, {} as never] },
          { position: "TE", need: 1, targets: [] },
        ],
      }),
    );
    expect(a.buyTargetCount).toBe(2);
    expect(a.buyPositionCount).toBe(1);
  });
});
