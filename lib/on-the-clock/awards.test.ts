import { describe, it, expect } from "vitest";
import { computeDraftAwards, type DraftAwardsInput } from "./awards";
import type { TeamRollup } from "./rosters";
import type { RankedPlayer } from "./board-types";
import type { ShapedPick } from "./types";
import type { HistoryTransaction, TradeHistoryContext } from "./trade-history";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "./default-settings";

// --- fixtures ---------------------------------------------------------------

function rollup(
  over: Partial<TeamRollup> & { rosterId: number; ownerName: string },
): TeamRollup {
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

function player(
  playerId: string,
  value: number,
  sleeperId: string,
): RankedPlayer {
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

function pick(
  over: Partial<ShapedPick> & { pickNo: number; rosterId: number },
): ShapedPick {
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

function txn(
  over: Partial<HistoryTransaction> & { transactionId: string },
): HistoryTransaction {
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
  rollup({
    rosterId: 1,
    ownerName: "Alpha",
    playersValue: 5000,
    playerCount: 3,
    isYou: true,
  }),
  rollup({
    rosterId: 2,
    ownerName: "Bravo",
    playersValue: 3000,
    playerCount: 3,
  }),
  rollup({
    rosterId: 3,
    ownerName: "Cara",
    playersValue: 1000,
    playerCount: 3,
  }),
];

const AVATARS = { 1: "av1", 2: null, 3: "av3" } as Record<
  number,
  string | null
>;

/** A three-player board with ADP, so the surplus curve has something to price against. */
const BOARD = [
  { ...player("A", 100, "sA"), adp: 20 },
  { ...player("B", 300, "sB"), adp: 30 },
  { ...player("C", 250, "sC"), adp: 10 },
];

function ctx(): TradeHistoryContext {
  const board = [
    player("A", 100, "sA"),
    player("B", 300, "sB"),
    player("C", 250, "sC"),
  ];
  return {
    valueBoard: board,
    available: board,
    poolBoard: board,
    futurePickValues: [],
    currentPicks: [],
    teamNameByRosterId: { 1: "Alpha", 2: "Bravo", 3: "Cara" },
    myRosterId: 1,
    teams: 3,
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
    adpBySleeperId: {},
    board: [],
    pulseTeams: [],
    isDynasty: false,
    ...over,
  };
}

function find(awards: ReturnType<typeof computeDraftAwards>, id: string) {
  return awards.find((a) => a.id === id)!;
}

// --- tests ------------------------------------------------------------------

describe("computeDraftAwards", () => {
  it("returns every enabled award in product order", () => {
    // Dynasty, so the one dynasty-only award is present. A redraft league is
    // deliberately one card shorter rather than one card emptier.
    const awards = computeDraftAwards(baseInput({ isDynasty: true }));
    expect(awards.map((a) => a.id)).toEqual([
      "most-active-trader",
      "most-successful-trader",
      "most-boring",
      "best-drafter",
      "worst-drafter",
      "best-starting-lineup",
      "long-game",
      "most-reliable",
      "boom-bust",
      "iron-man",
      "steal-of-draft",
      "reach-of-draft",
      "round-steals",
      "most-balanced",
      "most-top-heavy",
      "bye-week-nightmare",
      "against-the-room",
      "late-round-haul",
      "toughest-schedule",
      "scarcity-read",
    ]);
  });

  it("drops an award the admin has switched off", () => {
    const awards = computeDraftAwards(
      baseInput({
        settings: {
          ...DEFAULT_ON_THE_CLOCK_SETTINGS,
          awards: {
            ...DEFAULT_ON_THE_CLOCK_SETTINGS.awards,
            enabled: { "boom-bust": false },
          },
        },
      }),
    );
    expect(awards.map((a) => a.id)).not.toContain("boom-bust");
    // Everything else survives: a missing key means enabled.
    expect(awards.map((a) => a.id)).toContain("iron-man");
  });

  it("crowns the best drafter by surplus value, not by pick number", () => {
    // The market curve comes from the board sorted by ADP: sC (ADP 10, value
    // 250), sA (ADP 20, value 100), sB (ADP 30, value 100 after the monotonic
    // clamp). So pick 1 is priced at 250 and everything past index 2 at 100.
    //
    // Alpha takes sA (value 100) at pick 8, priced 100, surplus 0.
    // Bravo takes sB (value 300) at pick 2, priced 100, surplus +200.
    // Cara takes sC (value 250) at pick 1, priced 250, surplus 0.
    //
    // Bravo wins on surplus even though Cara's pick came first, which is the
    // whole point: the metric measures what you got for the slot you spent.
    const picks = [
      pick({ pickNo: 8, rosterId: 1, sleeperPlayerId: "sA" }),
      pick({ pickNo: 2, rosterId: 2, sleeperPlayerId: "sB" }),
      pick({ pickNo: 1, rosterId: 3, sleeperPlayerId: "sC" }),
    ];
    const awards = computeDraftAwards(
      baseInput({
        picks,
        board: BOARD,
        settings: {
          ...DEFAULT_ON_THE_CLOCK_SETTINGS,
          awards: { ...DEFAULT_ON_THE_CLOCK_SETTINGS.awards, minAdpPicks: 1 },
        },
      }),
    );
    const best = find(awards, "best-drafter");
    expect(best.pending).toBe(false);
    expect(best.claimants.map((c) => c.ownerName)).toEqual(["Bravo"]);
    expect(best.metricLabel).toContain("value over market");
  });

  it("names the steal and the reach of the draft as single picks", () => {
    const picks = [
      pick({
        pickNo: 20,
        rosterId: 2,
        sleeperPlayerId: "sB",
        lastName: "Steal",
      }),
      pick({
        pickNo: 1,
        rosterId: 1,
        sleeperPlayerId: "sA",
        lastName: "Reach",
      }),
    ];
    const awards = computeDraftAwards(
      baseInput({
        picks,
        board: BOARD,
        settings: {
          ...DEFAULT_ON_THE_CLOCK_SETTINGS,
          awards: { ...DEFAULT_ON_THE_CLOCK_SETTINGS.awards, minAdpPicks: 1 },
        },
      }),
    );
    const steal = find(awards, "steal-of-draft");
    expect(steal.pending).toBe(false);
    expect(steal.pickHighlight?.pickNo).toBe(20);
    expect(steal.pickHighlight?.surplus).toBeGreaterThan(0);

    const reach = find(awards, "reach-of-draft");
    expect(reach.pending).toBe(false);
    expect(reach.pickHighlight?.pickNo).toBe(1);
    expect(reach.pickHighlight?.surplus).toBeLessThan(0);
  });

  it("leaves the projection-backed awards pending with no Draft Pulse", () => {
    const awards = computeDraftAwards(baseInput({ pulseTeams: [] }));
    for (const id of [
      "best-starting-lineup",
      "most-reliable",
      "boom-bust",
      "iron-man",
    ]) {
      const award = find(awards, id);
      expect(award.pending).toBe(true);
      expect(award.pendingLabel).toContain("projections");
    }
  });

  it("keeps the Long Game award out of a redraft league entirely", () => {
    // Not emitted, rather than emitted permanently pending. There is no future
    // to build toward in a redraft league, so the card could never be won, and
    // "up for grabs" is a promise the reader would wait on forever.
    const awards = computeDraftAwards(baseInput({ isDynasty: false }));
    expect(awards.map((a) => a.id)).not.toContain("long-game");
  });

  it("still emits it in a dynasty league", () => {
    const awards = computeDraftAwards(baseInput({ isDynasty: true }));
    expect(awards.map((a) => a.id)).toContain("long-game");
  });

  it("leaves both drafter awards pending when no ADP data exists for the draft", () => {
    const picks = [
      pick({ pickNo: 1, rosterId: 1, sleeperPlayerId: "sA" }),
      pick({ pickNo: 2, rosterId: 2, sleeperPlayerId: "sB" }),
    ];
    const awards = computeDraftAwards(baseInput({ picks, adpBySleeperId: {} }));
    const best = find(awards, "best-drafter");
    expect(best.pending).toBe(true);
    expect(best.pendingLabel).toContain("Sleeper ADP is not available");
    const worst = find(awards, "worst-drafter");
    expect(worst.pending).toBe(true);
    expect(worst.pendingLabel).toContain("Sleeper ADP is not available");
  });

  it("excludes keeper picks from both drafter ADP calculations", () => {
    // Bravo's only pick is a keeper: keepers are assigned, not drafted against
    // the market, so Bravo has no ADP-eligible picks and Alpha lacks a rival.
    const picks = [
      pick({ pickNo: 30, rosterId: 1, sleeperPlayerId: "sB" }),
      {
        ...pick({ pickNo: 5, rosterId: 2, sleeperPlayerId: "sC" }),
        isKeeper: true,
      },
    ];
    const awards = computeDraftAwards(
      baseInput({ picks, adpBySleeperId: { sB: 44, sC: 28 } }),
    );
    expect(find(awards, "best-drafter").pending).toBe(true);
    expect(find(awards, "worst-drafter").pending).toBe(true);
  });

  it("leaves both drafter awards pending on an exact all-way tie", () => {
    // Every eligible team nets the same delta, so neither award crowns anyone.
    const picks = [
      pick({ pickNo: 20, rosterId: 1, sleeperPlayerId: "sA" }),
      pick({ pickNo: 30, rosterId: 2, sleeperPlayerId: "sB" }),
    ];
    const awards = computeDraftAwards(
      baseInput({ picks, adpBySleeperId: { sA: 10, sB: 20 } }),
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

  it("uses average margin per trade for the most successful trader (minimum relaxes to one)", () => {
    // Alpha(1) sends A(100), receives B(300): +200 margin over a single trade. Only one
    // trade each, so the 3- and 2-trade bars relax down to 1 and Alpha qualifies.
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
    expect(success.metricLabel).toBe("+200 avg value per trade across 1 trade");
  });

  it("rewards the best average margin, not the most total trade value", () => {
    // Alpha(1) makes 4 winning swaps (gives A=100, gets B=300 => +200 each):
    //   total +800 across 4 trades, average +200.
    // Bravo(2) makes 3 stronger deals (receives C=250 for nothing => +250 each):
    //   total +750 across 3 trades, average +250.
    // Alpha has the higher TOTAL, but Bravo has the higher AVERAGE and wins the award.
    const transactions: HistoryTransaction[] = [];
    for (let i = 0; i < 4; i++) {
      transactions.push(
        txn({
          transactionId: `a${i}`,
          rosterIds: [1, 3],
          adds: { sB: 1, sA: 3 },
          drops: { sA: 1, sB: 3 },
        }),
      );
    }
    for (let i = 0; i < 3; i++) {
      transactions.push(
        txn({
          transactionId: `b${i}`,
          rosterIds: [2, 3],
          adds: { sC: 2 },
          drops: { sC: 3 },
        }),
      );
    }
    const awards = computeDraftAwards(baseInput({ transactions }));
    const success = find(awards, "most-successful-trader");
    expect(success.pending).toBe(false);
    expect(success.claimants.map((c) => c.ownerName)).toEqual(["Bravo"]);
    expect(success.metricLabel).toBe(
      "+250 avg value per trade across 3 trades",
    );
  });

  it("relaxes the trade minimum to two when no team has three", () => {
    // Alpha(1) makes 2 winning swaps (+200 each); Bravo(2) the losing mirror. Nobody
    // reaches 3 trades, so the bar relaxes to 2 and Alpha qualifies at +200 average.
    const transactions: HistoryTransaction[] = [];
    for (let i = 0; i < 2; i++) {
      transactions.push(
        txn({
          transactionId: `t${i}`,
          rosterIds: [1, 2],
          adds: { sB: 1, sA: 2 },
          drops: { sA: 1, sB: 2 },
        }),
      );
    }
    const awards = computeDraftAwards(baseInput({ transactions }));
    const success = find(awards, "most-successful-trader");
    expect(success.pending).toBe(false);
    expect(success.claimants.map((c) => c.ownerName)).toEqual(["Alpha"]);
    expect(success.metricLabel).toBe(
      "+200 avg value per trade across 2 trades",
    );
  });

  it("stays pending for the value award when the board context is missing", () => {
    const transactions = [txn({ transactionId: "t1", rosterIds: [1, 2] })];
    const awards = computeDraftAwards(
      baseInput({ transactions, tradeContext: null }),
    );
    const success = find(awards, "most-successful-trader");
    expect(success.pending).toBe(true);
    expect(success.pendingLabel).toMatch(/loading/i);
    // Counts do not need the board, so Most Active still resolves.
    expect(find(awards, "most-active-trader").pending).toBe(false);
  });

  it("no longer emits the retired starting-roster award", () => {
    // It measured who assembled a legal lineup earliest, which in a snake draft
    // mostly measures who took a kicker in the ninth round: a bad decision the
    // award was congratulating. Old snapshots still render it from their frozen
    // payload; nothing computes it any more.
    const draftSettings = { teams: 3, slots_qb: 1, slots_rb: 1, slots_wr: 1 };
    const picks = [
      pick({ pickNo: 1, rosterId: 1, position: "QB" }),
      pick({ pickNo: 3, rosterId: 1, position: "RB" }),
      pick({ pickNo: 5, rosterId: 1, position: "WR" }),
    ];
    const awards = computeDraftAwards(baseInput({ draftSettings, picks }));
    expect(awards.map((a) => a.id)).not.toContain("first-starting-roster");
  });
});
