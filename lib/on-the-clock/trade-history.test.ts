import { describe, expect, it } from "vitest";
import { analyzeTradeTransaction, type TradeHistoryContext } from "./trade-history";
import type { RankedPlayer } from "./board-types";
import type { ShapedPick } from "./types";

function player(playerId: string, value: number, sleeperId: string): RankedPlayer {
  return {
    playerId,
    sleeperId,
    name: playerId,
    position: "WR",
    team: null,
    overallRank: 1,
    positionRank: 1,
    tier: 1,
    value,
    isRookie: false,
  };
}

function made(over: Partial<ShapedPick>): ShapedPick {
  return {
    pickNo: 1,
    round: 1,
    draftSlot: 1,
    rosterId: 1,
    pickedBy: "u1",
    sleeperPlayerId: null,
    playerId: null,
    isKeeper: false,
    firstName: "Roquan",
    lastName: "Smith",
    position: "LB",
    team: "BAL",
    ...over,
  };
}

function ctx(madePick: ShapedPick): TradeHistoryContext {
  const board = [player("A", 100, "sA")];
  return {
    valueBoard: board,
    available: board,
    poolBoard: board,
    futurePickValues: [],
    currentPicks: [
      {
        overall: 1,
        round: 1,
        pickInRound: 1,
        slot: 1,
        originalRosterId: 1,
        currentOwnerRosterId: 2,
        ownershipKnown: true,
        made: true,
        madePick,
      },
    ],
    teamNameByRosterId: { 1: "Alpha", 2: "Bravo" },
    myRosterId: 1,
    teams: 2,
    currentSeason: 2026,
  };
}

const txn = {
  transactionId: "t1",
  status: "complete",
  week: null,
  createdAt: null,
  rosterIds: [1, 2],
  adds: { sA: 1 },
  drops: { sA: 2 },
  picks: [{ season: 2026, round: 1, originalRosterId: 1, newOwnerRosterId: 2, previousOwnerRosterId: 1 }],
  faab: [],
};

describe("made picks in trade history", () => {
  it("says No market value once for a defender: in the value column, not again in the detail", () => {
    const entry = analyzeTradeTransaction(txn, ctx(made({ sleeperPlayerId: "sLB", position: "LB" })));
    const asset = entry.sides.flatMap((s) => s.assets).find((a) => a.kind === "made-pick");
    expect(asset?.noValue).toBe(true);
    expect(asset?.unpriced).toBe(true);
    expect(asset?.detail).toBe("Pick used, LB");
    expect(asset?.detail).not.toMatch(/market value/i);
  });

  it("still gives an unvalued offensive pick its reason", () => {
    const entry = analyzeTradeTransaction(
      txn,
      ctx(made({ sleeperPlayerId: "sWR", position: "WR", firstName: "Off", lastName: "Board" })),
    );
    const asset = entry.sides.flatMap((s) => s.assets).find((a) => a.kind === "made-pick");
    expect(asset?.unpriced).toBeUndefined();
    expect(asset?.detail).toBe("Pick used, WR - no FF Beacon value");
  });
});
