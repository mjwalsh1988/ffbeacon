import { describe, expect, it } from "vitest";
import { mulberry32 } from "../random";
import { leagueTrades, overFloor } from "./league-trades";
import { fakeCtx } from "./test-context";
import { underCeiling, waiverWire } from "./waiver-wire";

describe("waiver_wire", () => {
  it("builds every ceiling and floor", () => {
    for (const ceiling of [0.25, 0.5]) {
      for (const floor of [12, 15, 20]) {
        const text = waiverWire.text({ ceiling, floor, week: 8 }, fakeCtx());
        expect(text).toBe(
          `Name a player rostered in under ${ceiling * 100} percent of our redraft leagues who scored ${floor} or more PPR points in week 8.`,
        );
      }
    }
  });

  it("is skipped with no completed week or no rate season", () => {
    expect(waiverWire.draw(mulberry32(1), fakeCtx({ completedWeek: null }))).toBeNull();
    expect(waiverWire.draw(mulberry32(1), fakeCtx({ rateSeason: null }))).toBeNull();
  });

  it("treats a player with no rate row as rate 0", () => {
    const rates = new Map([
      ["a", 0.9],
      ["b", 0.1],
    ]);
    expect(underCeiling(["a", "b", "c"], rates, 0.25)).toEqual(["b", "c"]);
  });
});

describe("league_trades", () => {
  it("builds every window and floor", () => {
    for (const days of [30, 90]) {
      for (const floor of [25, 50, 100]) {
        expect(leagueTrades.text({ days, floor }, fakeCtx())).toBe(
          `Name a player traded in more than ${floor} of our leagues in the last ${days} days.`,
        );
      }
    }
  });

  it("keeps counts strictly over the floor", () => {
    expect(
      overFloor(
        [
          { sleeper_player_id: "1", league_count: 25 },
          { sleeper_player_id: "2", league_count: 26 },
        ],
        25,
      ),
    ).toEqual(["2"]);
  });
});
