import { describe, expect, it } from "vitest";
import { activityBand, computeActivity, type ActivityInput } from "./activity";
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
    expect([a.sellsPct, a.buildsPct, a.holdsPct]).toEqual([50, 25, 25]);
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
    expect(computeActivity(base()).driver).toBe("Driven mostly by 2 players worth selling.");
    expect(
      computeActivity(base({ calls: { d: call("hold") }, needPositions: ["RB", "TE"] })).driver,
    ).toBe("Driven mostly by needs at RB and TE.");
    expect(
      computeActivity(
        base({ calls: { d: call("hold") }, needPositions: [], rankDivergence: -6, valueRank: 3, pulseRank: 9 }),
      ).driver,
    ).toBe("Driven mostly by the gap between value rank 3 and Pulse rank 9.");
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
