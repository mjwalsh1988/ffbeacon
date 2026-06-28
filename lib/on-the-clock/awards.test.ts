import { describe, it, expect } from "vitest";
import { computeDraftAwards, type DraftAwardsInput } from "./awards";
import type { TeamRollup } from "./rosters";
import type { RankedPlayer } from "./board-types";
import type { ShapedPick } from "./types";
import type { HistoryTransaction, TradeHistoryContext } from "./trade-history";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "./default-settings";

// --- fixtures ---------------------------------------------------------------

function rollup(over: Partial<TeamRollup> & { rosterId: number; ownerName: string }): TeamRollup {
  return {
    rosterId: over.rosterId,
    ownerName: over.ownerName,
    teamName: over.teamName ?? null,
    isYou: over.isYou ?? false,
    players: { QB: [], RB: [], WR: [], TE: [] },
    positionTotals: { QB: 0, RB: 0, WR: 0, TE: 0 },
    playersValue: over.playersValue ?? 0,
    playerCount: over.playerCount ?? 0,
    futurePicks: [],
    futurePicksValue: 0,
    totalValue: over.totalValue ?? over.playersValue ?? 0,
    rank: over.rank ?? 0,
  };
}

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

function pick(over: Partial<ShapedPick> & { pickNo: number; rosterId: number }): ShapedPick {
  return {
    pickNo: over.pickNo,
    round: over.round ?? 1,
    draftSlot: over.draftSlot ?? over.rosterId,
    rosterId: over.rosterId,
    pickedBy: over.pickedBy ?? `u${over.rosterId}`,
    sleeperPlayerId: over.sleeperPlayerId ?? null,
    playerId: over.playerId ?? null,
    isKeeper: false,
    firstName: over.firstName ?? "First",
    lastName: over.lastName ?? `L${over.pickNo}`,
    position: over.position ?? "WR",
    team: over.team ?? null,
  };
}

function txn(over: Partial<HistoryTransaction> & { transactionId: string }): HistoryTransaction {
  return {
    transactionId: over.transactionId,
    status: over.status ?? "complete",
    week: over.week ?? null,
    createdAt: over.createdAt ?? null,
    rosterIds: over.rosterIds ?? [],
    adds: over.adds ?? {},
    drops: over.drops ?? {},
    picks: over.picks ?? [],
    faab: over.faab ?? [],
  };
}

const ROLLUPS: TeamRollup[] = [
  rollup({ rosterId: 1, ownerName: "Alpha", playersValue: 5000, playerCount: 3, isYou: true }),
  rollup({ rosterId: 2, ownerName: "Bravo", playersValue: 3000, playerCount: 3 }),
  rollup({ rosterId: 3, ownerName: "Cara", playersValue: 1000, playerCount: 3 }),
];

const AVATARS = { 1: "av1", 2: null, 3: "av3" } as Record<number, string | null>;

function ctx(): TradeHistoryContext {
  const board = [player("A", 100, "sA"), player("B", 300, "sB"), player("C", 250, "sC")];
  return {
    valueBoard: board,
    available: board,
    poolBoard: board,
    currentPicks: [],
    teamNameByRosterId: { 1: "Alpha", 2: "Bravo", 3: "Cara" },
    myRosterId: 1,
    teams: 3,
    onTheClockPickNo: 0,
    currentSeason: 2026,
  };
}

function baseInput(over: Partial<DraftAwardsInput> = {}): DraftAwardsInput {
  return {
    rollups: ROLLUPS,
    avatarByRosterId: AVATARS,
    transactions: [],
    tradeContext: ctx(),
    picks: [],
    draftSettings: { teams: 3 },
    settings: DEFAULT_ON_THE_CLOCK_SETTINGS,
    ...over,
  };
}

function find(awards: ReturnType<typeof computeDraftAwards>, id: string) {
  return awards.find((a) => a.id === id)!;
}

// --- tests ------------------------------------------------------------------

describe("computeDraftAwards", () => {
  it("returns the six awards in product order", () => {
    const awards = computeDraftAwards(baseInput());
    expect(awards.map((a) => a.id)).toEqual([
      "most-active-trader",
      "most-successful-trader",
      "first-starting-roster",
      "most-boring",
      "best-drafter",
      "worst-drafter",
    ]);
  });

  it("crowns the best and worst drafter by drafted-player value", () => {
    const awards = computeDraftAwards(baseInput());
    const best = find(awards, "best-drafter");
    const worst = find(awards, "worst-drafter");
    expect(best.pending).toBe(false);
    expect(best.claimants.map((c) => c.ownerName)).toEqual(["Alpha"]);
    expect(best.metricLabel).toBe("5,000 drafted value");
    expect(worst.claimants.map((c) => c.ownerName)).toEqual(["Cara"]);
    expect(worst.metricLabel).toBe("1,000 drafted value");
    // The connected team + avatar travel onto the claimant.
    expect(best.claimants[0].isYou).toBe(true);
    expect(best.claimants[0].avatar).toBe("av1");
  });

  it("leaves drafter awards pending until at least two teams have drafted", () => {
    const awards = computeDraftAwards(
      baseInput({
        rollups: [
          rollup({ rosterId: 1, ownerName: "Alpha", playersValue: 5000, playerCount: 2 }),
          rollup({ rosterId: 2, ownerName: "Bravo", playersValue: 0, playerCount: 0 }),
        ],
      }),
    );
    expect(find(awards, "best-drafter").pending).toBe(true);
    expect(find(awards, "worst-drafter").pending).toBe(true);
  });

  it("counts trades for most active and fewest for most boring", () => {
    // Alpha(1) trades with Bravo(2), then with Cara(3). Cara only has the one.
    const transactions = [
      txn({ transactionId: "t1", rosterIds: [1, 2] }),
      txn({ transactionId: "t2", rosterIds: [1, 3] }),
    ];
    const awards = computeDraftAwards(baseInput({ transactions }));
    const active = find(awards, "most-active-trader");
    const boring = find(awards, "most-boring");
    expect(active.pending).toBe(false);
    expect(active.claimants.map((c) => c.ownerName)).toEqual(["Alpha"]);
    expect(active.metricLabel).toBe("2 trades");
    // Bravo and Cara are tied at one trade each, so both share Dead Air.
    expect(boring.pending).toBe(false);
    expect(boring.claimants.map((c) => c.ownerName)).toEqual(["Bravo", "Cara"]);
    expect(boring.metricLabel).toBe("1 trade");
  });

  it("leaves trade awards up for grabs with no trades", () => {
    const awards = computeDraftAwards(baseInput());
    expect(find(awards, "most-active-trader").pending).toBe(true);
    expect(find(awards, "most-successful-trader").pending).toBe(true);
    expect(find(awards, "most-boring").pending).toBe(true);
  });

  it("nets received minus given for the most successful trader", () => {
    // Alpha(1) sends A(100), receives B(300): net +200. Bravo(2) the mirror: net -200.
    const transactions = [
      txn({
        transactionId: "t1",
        rosterIds: [1, 2],
        adds: { sB: 1, sA: 2 },
        drops: { sA: 1, sB: 2 },
      }),
    ];
    const awards = computeDraftAwards(baseInput({ transactions }));
    const success = find(awards, "most-successful-trader");
    expect(success.pending).toBe(false);
    expect(success.claimants.map((c) => c.ownerName)).toEqual(["Alpha"]);
    expect(success.metricLabel).toBe("+200 value");
  });

  it("stays pending for the value award when the board context is missing", () => {
    const transactions = [txn({ transactionId: "t1", rosterIds: [1, 2] })];
    const awards = computeDraftAwards(baseInput({ transactions, tradeContext: null }));
    const success = find(awards, "most-successful-trader");
    expect(success.pending).toBe(true);
    expect(success.pendingLabel).toMatch(/loading/i);
    // Counts do not need the board, so Most Active still resolves.
    expect(find(awards, "most-active-trader").pending).toBe(false);
  });

  it("awards the first team to fill every required starting slot", () => {
    // 1 QB / 1 RB / 1 WR starting lineup (no K/DEF). Alpha finishes at pick 5.
    const draftSettings = { teams: 3, slots_qb: 1, slots_rb: 1, slots_wr: 1 };
    const picks = [
      pick({ pickNo: 1, rosterId: 1, position: "QB" }),
      pick({ pickNo: 2, rosterId: 2, position: "QB" }),
      pick({ pickNo: 3, rosterId: 1, position: "RB" }),
      pick({ pickNo: 4, rosterId: 2, position: "RB" }),
      pick({ pickNo: 5, rosterId: 1, position: "WR" }),
      pick({ pickNo: 6, rosterId: 2, position: "WR" }),
    ];
    const awards = computeDraftAwards(baseInput({ draftSettings, picks }));
    const full = find(awards, "first-starting-roster");
    expect(full.pending).toBe(false);
    expect(full.claimants.map((c) => c.ownerName)).toEqual(["Alpha"]);
    expect(full.metricLabel).toBe("Filled at pick 5");
  });

  it("keeps the starting-roster award pending until a lineup is complete", () => {
    const draftSettings = { teams: 3, slots_qb: 1, slots_rb: 1, slots_wr: 1 };
    const picks = [
      pick({ pickNo: 1, rosterId: 1, position: "QB" }),
      pick({ pickNo: 2, rosterId: 1, position: "RB" }),
    ];
    const awards = computeDraftAwards(baseInput({ draftSettings, picks }));
    expect(find(awards, "first-starting-roster").pending).toBe(true);
  });
});
