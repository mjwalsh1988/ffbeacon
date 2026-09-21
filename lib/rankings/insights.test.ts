import { describe, expect, it } from "vitest";
import type { RankingsBoardRow } from "@/lib/rankings-board";
import { boardPulse, enrichBoardRows, topMovers } from "@/lib/rankings/insights";

let nextRank = 0;

function row(overrides: Partial<RankingsBoardRow> = {}): RankingsBoardRow {
  nextRank += 1;
  return {
    overall_rank: nextRank,
    position_rank: nextRank,
    slug: `player-${nextRank}`,
    sleeper_id: null,
    name: `Player ${nextRank}`,
    position: "WR",
    team: "BUF",
    status: "active",
    value: 5000,
    change_30d_pct: null,
    trend_30d: null,
    rank_change_30d: null,
    show_trend_30d: false,
    high_30d: null,
    low_30d: null,
    change_7d_pct: null,
    rank_change_7d: null,
    show_trend_7d: false,
    ...overrides,
  };
}

describe("enrichBoardRows", () => {
  it("tiers by position from the value cliffs", () => {
    // The database percentile column is gone entirely; the only tier on a row
    // is this one, and it has to follow the values.
    const rows = [
      row({ position: "WR", value: 10000 }),
      row({ position: "WR", value: 4000 }),
    ];
    const out = enrichBoardRows(rows);
    expect(out[0].tier).toBe(1);
    expect(out[1].tier).toBe(2);
    // And the gap into that second tier is flagged on the row above it, which
    // is what the Gap column tones on.
    expect(out[0].opensNextTier).toBe(true);
    expect(out[1].opensNextTier).toBe(false);
  });

  it("carries the gap to the next player at the same position", () => {
    const rows = [
      row({ position: "RB", value: 9000 }),
      row({ position: "WR", value: 8500 }),
      row({ position: "RB", value: 6000 }),
    ];
    const out = enrichBoardRows(rows);
    // The running back's next man down is the other running back, not the
    // receiver sitting between them on the overall board.
    expect(out[0].gapToNext).toBe(3000);
    expect(out[1].gapToNext).toBeNull();
  });
});

describe("topMovers", () => {
  it("ranks risers and fallers by percentage move", () => {
    const rows = enrichBoardRows([
      row({ value: 5000, show_trend_7d: true, change_7d_pct: 2, rank_change_7d: 1 }),
      row({ value: 5000, show_trend_7d: true, change_7d_pct: 9, rank_change_7d: 8 }),
      row({ value: 5000, show_trend_7d: true, change_7d_pct: -6, rank_change_7d: -4 }),
      row({ value: 5000, show_trend_7d: true, change_7d_pct: -11, rank_change_7d: -9 }),
    ]);
    const movers = topMovers(rows, { window: "7d", limit: 5 });
    expect(movers.risers.map((m) => m.pct)).toEqual([9, 2]);
    expect(movers.fallers.map((m) => m.pct)).toEqual([-11, -6]);
    expect(movers.considered).toBe(4);
  });

  it("respects the limit at both ends", () => {
    const rows = enrichBoardRows(
      [12, 9, 6, 3, 1, -1, -3, -6, -9, -12].map((pct) =>
        row({ value: 5000, show_trend_7d: true, change_7d_pct: pct }),
      ),
    );
    const movers = topMovers(rows, { window: "7d", limit: 2 });
    expect(movers.risers.map((m) => m.pct)).toEqual([12, 9]);
    expect(movers.fallers.map((m) => m.pct)).toEqual([-12, -9]);
  });

  it("ignores the bottom of the board, where a tiny move is a big percentage", () => {
    const rows = enrichBoardRows([
      row({ value: 10000, show_trend_7d: true, change_7d_pct: 3 }),
      // Worth 40 on a 10,000 board, so under the 500 floor: his 60% week is
      // fifteen points of noise and must not lead the list.
      row({ value: 40, show_trend_7d: true, change_7d_pct: 60 }),
    ]);
    const movers = topMovers(rows, { window: "7d" });
    expect(movers.risers.map((m) => m.pct)).toEqual([3]);
    expect(movers.considered).toBe(1);
  });

  it("ignores a player who was a rounding error at the start of the window", () => {
    const rows = enrichBoardRows([
      row({ value: 10000, show_trend_7d: true, change_7d_pct: 3 }),
      // 600 today clears the 500 floor, but +631.8% means he was worth about
      // 82 a week ago. A true percentage and a useless headline.
      row({ value: 600, show_trend_7d: true, change_7d_pct: 631.8 }),
    ]);
    const movers = topMovers(rows, { window: "7d" });
    expect(movers.risers.map((m) => m.pct)).toEqual([3]);
    expect(movers.considered).toBe(1);
  });

  it("keeps a real collapse, and drops one that divides by zero", () => {
    const rows = enrichBoardRows([
      row({ value: 10000, show_trend_7d: true, change_7d_pct: -3 }),
      // Was 15,000, is 600. Both ends clear the floor, so this is a genuine
      // fall and belongs at the top of the sold list.
      row({ value: 600, show_trend_7d: true, change_7d_pct: -96 }),
      // A total wipeout divides by zero on the way back. Dropped, not crashed.
      row({ value: 600, show_trend_7d: true, change_7d_pct: -100 }),
    ]);
    const movers = topMovers(rows, { window: "7d" });
    expect(movers.considered).toBe(2);
    expect(movers.fallers.map((m) => m.pct)).toEqual([-96, -3]);
  });

  it("keeps everyone on a board whose whole scale is small", () => {
    // Kickers: 242 down to 66. The floor is 4.84, so nobody is excluded.
    const rows = enrichBoardRows(
      [242, 150, 66].map((value) =>
        row({ position: "K", value, show_trend_7d: true, change_7d_pct: 5 }),
      ),
    );
    expect(topMovers(rows, { window: "7d" }).considered).toBe(3);
  });

  it("skips a row whose window gate is off rather than calling it flat", () => {
    const rows = enrichBoardRows([
      row({ value: 5000, show_trend_7d: false, change_7d_pct: 20 }),
      row({ value: 5000, show_trend_7d: true, change_7d_pct: 4 }),
    ]);
    const movers = topMovers(rows, { window: "7d" });
    expect(movers.considered).toBe(1);
    expect(movers.risers.map((m) => m.pct)).toEqual([4]);
  });

  it("reads the 30-day columns when asked for the 30-day window", () => {
    const rows = enrichBoardRows([
      row({
        value: 5000,
        show_trend_7d: true,
        change_7d_pct: -8,
        show_trend_30d: true,
        change_30d_pct: 22,
        rank_change_30d: 14,
      }),
    ]);
    // A bad week inside a good month. Each window answers for itself.
    expect(topMovers(rows, { window: "7d" }).fallers[0].pct).toBe(-8);
    const month = topMovers(rows, { window: "30d" }).risers[0];
    expect(month.pct).toBe(22);
    expect(month.rankChange).toBe(14);
  });
});

describe("boardPulse", () => {
  it("counts the last 30 days by default, and reconciles to withWindow", () => {
    const rows = enrichBoardRows([
      row({ value: 5000, show_trend_30d: true, change_30d_pct: 4 }),
      row({ value: 5000, show_trend_30d: true, change_30d_pct: -4 }),
      row({ value: 5000, show_trend_30d: true, change_30d_pct: 0 }),
      row({ value: 5000, show_trend_30d: false, change_30d_pct: 99 }),
    ]);
    const pulse = boardPulse(rows);
    expect(pulse).toMatchObject({ withWindow: 3, rising: 1, falling: 1, holding: 1 });
    expect(pulse.rising + pulse.falling + pulse.holding).toBe(pulse.withWindow);
  });

  it("defaults to the 30-day window, which is what the table's columns show", () => {
    // Every row has a good month and a bad week. The default must report the
    // month, or the strip contradicts the table directly under it.
    const rows = enrichBoardRows([
      row({
        value: 5000,
        show_trend_30d: true,
        change_30d_pct: 12,
        show_trend_7d: true,
        change_7d_pct: -6,
      }),
    ]);
    expect(boardPulse(rows)).toMatchObject({ rising: 1, falling: 0 });
    expect(boardPulse(rows, { window: "7d" })).toMatchObject({
      rising: 0,
      falling: 1,
    });
  });

  it("names the biggest climber over the same window it counted", () => {
    const rows = enrichBoardRows([
      row({
        value: 5000,
        name: "Month Riser",
        show_trend_30d: true,
        change_30d_pct: 30,
        show_trend_7d: true,
        change_7d_pct: 1,
      }),
      row({
        value: 5000,
        name: "Week Riser",
        show_trend_30d: true,
        change_30d_pct: 2,
        show_trend_7d: true,
        change_7d_pct: 20,
      }),
    ]);
    expect(boardPulse(rows).biggestRiser?.name).toBe("Month Riser");
    expect(boardPulse(rows, { window: "7d" }).biggestRiser?.name).toBe("Week Riser");
  });

  it("counts the same players the movers list ranks, so the strip cannot contradict itself", () => {
    // The strip prints "N gained value" from these counts and "biggest
    // climber" from topMovers. When the counts ignored the value floor and
    // the climber respected it, a board whose only gainers sat in the tail
    // said "2 players gained value" and "No player gained value" side by
    // side, in adjacent tiles.
    const rows = enrichBoardRows([
      row({ value: 10000, show_trend_30d: true, change_30d_pct: -2 }),
      row({ value: 100, show_trend_30d: true, change_30d_pct: 40 }),
      row({ value: 80, show_trend_30d: true, change_30d_pct: 30 }),
    ]);
    const pulse = boardPulse(rows);
    expect(pulse.rising).toBe(0);
    expect(pulse.biggestRiser).toBeNull();
    expect(pulse).toMatchObject({ withWindow: 1, falling: 1, holding: 0 });
  });

  it("does not count a wipeout as a faller while excluding it from the list", () => {
    const rows = enrichBoardRows([
      row({ value: 10000, show_trend_30d: true, change_30d_pct: -100 }),
      row({ value: 10000, show_trend_30d: true, change_30d_pct: -150 }),
      row({ value: 10000, show_trend_30d: true, change_30d_pct: -5 }),
    ]);
    const pulse = boardPulse(rows);
    expect(pulse.falling).toBe(1);
    expect(pulse.biggestFaller?.pct).toBe(-5);
  });

  it("names the steepest cliff and the position it belongs to", () => {
    const rows = enrichBoardRows([
      // Quarterbacks: a 6,000 point cliff after the first one.
      row({ position: "QB", value: 10000 }),
      row({ position: "QB", value: 4000 }),
      // Receivers: a 1,000 point cliff.
      row({ position: "WR", value: 9000 }),
      row({ position: "WR", value: 8000 }),
    ]);
    expect(boardPulse(rows).cliff).toEqual({ position: "QB", tier: 1, drop: 6000 });
  });

  it("does not invent a cliff between two different positions", () => {
    const rows = enrichBoardRows([
      row({ position: "QB", value: 10000 }),
      row({ position: "TE", value: 100 }),
    ]);
    // One player per position means no adjacent pair anywhere, so no cliff.
    expect(boardPulse(rows).cliff).toBeNull();
  });

  it("survives an empty board", () => {
    expect(boardPulse([])).toMatchObject({
      withWindow: 0,
      rising: 0,
      falling: 0,
      holding: 0,
      biggestRiser: null,
      biggestFaller: null,
      cliff: null,
    });
  });
});
