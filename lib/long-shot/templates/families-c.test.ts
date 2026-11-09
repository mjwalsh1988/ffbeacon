import { describe, expect, it } from "vitest";
import { mulberry32 } from "../random";
import { leagueTrades, mostTraded } from "./league-trades";
import { fakeCtx } from "./test-context";
import { underCeiling, waiverWire, weeksOf } from "./waiver-wire";

describe("waiver_wire", () => {
  it("says one week or a span of weeks", () => {
    expect(waiverWire.text({ ceiling: 0.25, floor: 12, span: 1, week: 8 }, fakeCtx())).toBe(
      "Name a player rostered in under 25 percent of our redraft leagues who scored 12 or more PPR points in week 8.",
    );
    expect(waiverWire.text({ ceiling: 0.5, floor: 20, span: 3, week: 8 }, fakeCtx())).toBe(
      "Name a player rostered in under 50 percent of our redraft leagues who scored 20 or more PPR points in any week from 6 to 8.",
    );
    expect(weeksOf({ span: 3, week: 2 })).toEqual([1, 2]);
  });

  it("is skipped with no completed week or no rate season", () => {
    expect(waiverWire.draws(mulberry32(1), fakeCtx({ completedWeek: null }))).toEqual([]);
    expect(waiverWire.draws(mulberry32(1), fakeCtx({ rateSeason: null }))).toEqual([]);
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
  it("builds every window and top", () => {
    for (const days of [30, 90]) {
      for (const top of [15, 30]) {
        expect(leagueTrades.text({ days, top }, fakeCtx())).toBe(
          `Name one of the ${top} most traded players across our leagues in the last ${days} days.`,
        );
      }
    }
  });

  it("keeps the top N by count with ties at the boundary", () => {
    const rows = [
      { sleeper_player_id: "1", league_count: 5 },
      { sleeper_player_id: "2", league_count: 9 },
      { sleeper_player_id: "3", league_count: 5 },
      { sleeper_player_id: "4", league_count: 0 },
    ];
    expect(mostTraded(rows, 2)).toEqual(["2", "1", "3"]);
    expect(mostTraded(rows, 1)).toEqual(["2"]);
  });
});
