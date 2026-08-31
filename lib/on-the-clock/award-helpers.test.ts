import { describe, it, expect } from "vitest";
import { roundOfPick, lastRound, scarcityCaptureByRoster } from "./awards";
import type { PickSurplus } from "./surplus";

function surplus(
  over: Partial<PickSurplus> & { pickNo: number; rosterId: number },
): PickSurplus {
  return {
    pickNo: over.pickNo,
    rosterId: over.rosterId,
    playerId: over.playerId ?? `p${over.pickNo}`,
    playerName: over.playerName ?? `Player ${over.pickNo}`,
    position: "position" in over ? (over.position ?? null) : "WR",
    value: over.value ?? 100,
    marketValue: over.marketValue ?? 100,
    surplus: over.surplus ?? 0,
  };
}

describe("roundOfPick", () => {
  it("reads a twelve-team room the way a drafter counts it", () => {
    expect(roundOfPick(1, 12)).toBe(1);
    expect(roundOfPick(12, 12)).toBe(1);
    expect(roundOfPick(13, 12)).toBe(2);
    expect(roundOfPick(24, 12)).toBe(2);
    expect(roundOfPick(25, 12)).toBe(3);
  });

  it("does not care whether the draft snakes", () => {
    // Sleeper numbers picks straight through either way, so the arithmetic is
    // the same and there is nothing to branch on.
    expect(roundOfPick(37, 12)).toBe(4);
  });

  it("survives a room size that never came through", () => {
    // A settings payload we could not read must not divide by zero or produce
    // an infinity that then propagates into a round label.
    expect(roundOfPick(25, 0)).toBe(1);
    expect(roundOfPick(25, Number.NaN)).toBe(1);
    expect(roundOfPick(Number.NaN, 12)).toBe(1);
    expect(roundOfPick(0, 12)).toBe(1);
  });
});

describe("lastRound", () => {
  it("finds the deepest round anyone actually reached", () => {
    const picks = [
      surplus({ pickNo: 1, rosterId: 1 }),
      surplus({ pickNo: 40, rosterId: 2 }),
    ];
    expect(lastRound(picks, 12)).toBe(4);
  });

  it("is zero for a draft nobody has started", () => {
    expect(lastRound([], 12)).toBe(0);
  });
});

describe("scarcityCaptureByRoster", () => {
  it("credits the gap to the next player taken at the same position", () => {
    // Alpha takes a 300 receiver; the next receiver off the board is worth 100.
    // That 200 is the shelf emptying behind them, which is the whole reason to
    // spend there.
    const picks = [
      surplus({ pickNo: 1, rosterId: 1, position: "WR", value: 300 }),
      surplus({ pickNo: 2, rosterId: 2, position: "WR", value: 100 }),
    ];
    const out = scarcityCaptureByRoster(picks);
    expect(out.get(1)).toBeCloseTo(200, 5);
  });

  it("credits nothing when someone just as good went later", () => {
    // The room had depth there. The pick did not create scarcity, so it does not
    // get to claim any.
    const picks = [
      surplus({ pickNo: 1, rosterId: 1, position: "WR", value: 100 }),
      surplus({ pickNo: 2, rosterId: 2, position: "WR", value: 300 }),
    ];
    const out = scarcityCaptureByRoster(picks);
    expect(out.get(1)).toBeUndefined();
    expect(out.get(2)).toBeUndefined();
  });

  it("keeps positions separate, because scarcity is per position", () => {
    const picks = [
      surplus({ pickNo: 1, rosterId: 1, position: "QB", value: 400 }),
      surplus({ pickNo: 2, rosterId: 2, position: "WR", value: 100 }),
      surplus({ pickNo: 3, rosterId: 2, position: "QB", value: 150 }),
      surplus({ pickNo: 4, rosterId: 1, position: "WR", value: 90 }),
    ];
    const out = scarcityCaptureByRoster(picks);
    // Alpha's quarterback beat the next one by 250. Bravo's receiver beat the
    // next one by only 10, which is depth rather than scarcity, and the two
    // never mix.
    expect(out.get(1)).toBeCloseTo(250, 5);
    expect(out.get(2)).toBeCloseTo(10, 5);
  });

  it("sums across a roster's picks", () => {
    const picks = [
      surplus({ pickNo: 1, rosterId: 1, position: "QB", value: 400 }),
      surplus({ pickNo: 2, rosterId: 1, position: "WR", value: 300 }),
      surplus({ pickNo: 3, rosterId: 2, position: "QB", value: 300 }),
      surplus({ pickNo: 4, rosterId: 2, position: "WR", value: 200 }),
    ];
    expect(scarcityCaptureByRoster(picks).get(1)).toBeCloseTo(200, 5);
  });

  it("ignores a pick with no position rather than bucketing it as unknown", () => {
    const picks = [
      surplus({ pickNo: 1, rosterId: 1, position: null, value: 400 }),
      surplus({ pickNo: 2, rosterId: 2, position: null, value: 100 }),
    ];
    expect(scarcityCaptureByRoster(picks).size).toBe(0);
  });

  it("credits nothing to the last player taken at a position", () => {
    // There is no next man up, so there is no measured gap. Awarding one would
    // mean inventing a replacement level the draft never showed us.
    const picks = [
      surplus({ pickNo: 1, rosterId: 1, position: "TE", value: 500 }),
    ];
    expect(scarcityCaptureByRoster(picks).size).toBe(0);
  });
});
