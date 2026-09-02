import { describe, it, expect } from "vitest";
import {
  buildDraftLedger,
  buildTradeLedger,
  buildWaiverLedger,
  LedgerIndex,
  roundBaselines,
  type IndexedWeek,
  type TransactionInput,
} from "./moves";
import type { LedgerPlayer } from "./lineup";

const PLAYERS: Map<string, LedgerPlayer> = new Map([
  ["a", { sleeperId: "a", name: "Player A", position: "RB" }],
  ["b", { sleeperId: "b", name: "Player B", position: "WR" }],
  ["c", { sleeperId: "c", name: "Player C", position: "TE" }],
  ["d", { sleeperId: "d", name: "Player D", position: "QB" }],
]);

/** Three weeks. Player "a" moves from roster 1 to roster 2 after week 1. */
const WEEKS: IndexedWeek[] = [
  {
    week: 1,
    sleeperRosterId: 1,
    playerPoints: new Map([
      ["a", 10],
      ["b", 5],
    ]),
    startedIds: new Set(["a"]),
  },
  { week: 1, sleeperRosterId: 2, playerPoints: new Map([["c", 7]]), startedIds: new Set(["c"]) },
  { week: 2, sleeperRosterId: 1, playerPoints: new Map([["b", 8]]), startedIds: new Set(["b"]) },
  {
    week: 2,
    sleeperRosterId: 2,
    playerPoints: new Map([
      ["a", 20],
      ["c", 4],
    ]),
    // "a" is on roster 2 but benched, so he scores for them without starting.
    startedIds: new Set(["c"]),
  },
  { week: 3, sleeperRosterId: 1, playerPoints: new Map([["b", 6]]), startedIds: new Set(["b"]) },
  {
    week: 3,
    sleeperRosterId: 2,
    playerPoints: new Map([
      ["a", 30],
      ["c", 2],
    ]),
    startedIds: new Set(["a"]),
  },
];

const index = new LedgerIndex(WEEKS);

describe("LedgerIndex", () => {
  it("credits a player only to the roster that held him that week", () => {
    // Roster 1 held "a" in week 1 only.
    expect(index.pointsFor("a", 1, 1)).toBe(10);
    // Roster 2 held him in weeks 2 and 3.
    expect(index.pointsFor("a", 2, 1)).toBe(50);
  });

  it("counts from the requested week forward and never behind it", () => {
    expect(index.pointsFor("a", 2, 3)).toBe(30);
    expect(index.pointsFor("a", 2, 4)).toBe(0);
  });

  it("separates points scored on a roster from points scored in its lineup", () => {
    // Weeks 2 and 3 on roster 2, but only week 3 in the starting lineup.
    expect(index.pointsFor("a", 2, 2)).toBe(50);
    expect(index.pointsStartedFor("a", 2, 2)).toEqual({ points: 30, weeks: 1 });
  });

  it("totals a player's production for whoever owned him", () => {
    expect(index.totalPoints("a")).toBe(60);
  });
});

const tx = (over: Partial<TransactionInput>): TransactionInput => ({
  id: "t1",
  type: "waiver",
  week: 1,
  adds: {},
  drops: {},
  bid: null,
  hasPicks: false,
  rosterIds: [],
  ...over,
});

describe("buildWaiverLedger", () => {
  it("credits a claim with what the player scored in that lineup afterward", () => {
    const ledger = buildWaiverLedger(
      2,
      [tx({ id: "w1", week: 2, adds: { a: 2 }, bid: 15, rosterIds: [2] })],
      index,
      PLAYERS,
      true,
    );
    expect(ledger.moves).toBe(1);
    expect(ledger.hits).toBe(1);
    expect(ledger.pointsOnRoster).toBe(50);
    expect(ledger.pointsStarted).toBe(30);
    expect(ledger.faabSpent).toBe(15);
    expect(ledger.pointsPerDollar).toBe(2);
  });

  it("counts one bid once when a single claim adds two players", () => {
    const ledger = buildWaiverLedger(
      2,
      [tx({ id: "w2", week: 2, adds: { a: 2, c: 2 }, bid: 20, rosterIds: [2] })],
      index,
      PLAYERS,
      true,
    );
    expect(ledger.moves).toBe(2);
    // Twenty dollars, not forty.
    expect(ledger.faabSpent).toBe(20);
  });

  it("reports no budget rather than a zero when the league runs no FAAB", () => {
    const ledger = buildWaiverLedger(
      2,
      [tx({ id: "w3", week: 2, adds: { a: 2 }, rosterIds: [2] })],
      index,
      PLAYERS,
      false,
    );
    expect(ledger.faabSpent).toBeNull();
    expect(ledger.pointsPerDollar).toBeNull();
  });

  it("counts a claim whose player never started as a move but not a hit", () => {
    const ledger = buildWaiverLedger(
      1,
      [tx({ id: "w4", week: 2, adds: { d: 1 }, rosterIds: [1] })],
      index,
      PLAYERS,
      true,
    );
    expect(ledger.moves).toBe(1);
    expect(ledger.hits).toBe(0);
    expect(ledger.pointsStarted).toBe(0);
  });

  it("ignores a trade, which belongs to the other ledger", () => {
    const ledger = buildWaiverLedger(
      2,
      [tx({ id: "tr", type: "trade", week: 2, adds: { a: 2 }, drops: { a: 1 }, rosterIds: [1, 2] })],
      index,
      PLAYERS,
      true,
    );
    expect(ledger.moves).toBe(0);
  });
});

describe("buildTradeLedger", () => {
  const trade = tx({
    id: "tr1",
    type: "trade",
    week: 2,
    adds: { a: 2 },
    drops: { a: 1 },
    rosterIds: [1, 2],
  });

  it("credits the receiving roster with what arrived and debits what left", () => {
    const received = buildTradeLedger(2, [trade], index, PLAYERS);
    expect(received.trades).toBe(1);
    expect(received.pointsIn).toBe(50);
    expect(received.pointsOut).toBe(0);
    expect(received.net).toBe(50);

    const sent = buildTradeLedger(1, [trade], index, PLAYERS);
    expect(sent.pointsIn).toBe(0);
    // What the player went on to score for his NEW owner.
    expect(sent.pointsOut).toBe(50);
    expect(sent.net).toBe(-50);
  });

  it("attributes a leg of a three-team trade to the roster that actually received it", () => {
    const threeWay = tx({
      id: "tr2",
      type: "trade",
      week: 2,
      adds: { a: 2, c: 1 },
      drops: { a: 1, c: 2 },
      rosterIds: [1, 2],
    });
    const one = buildTradeLedger(1, [threeWay], index, PLAYERS);
    // Roster 1 sent "a" (who scored 50 for roster 2) and received "c" (who
    // stayed on roster 2 in the fixture, so he scored nothing FOR roster 1).
    expect(one.pointsOut).toBe(50);
    expect(one.pointsIn).toBe(0);
  });

  it("records a pick-only trade at a net of zero and flags it rather than dropping it", () => {
    const pickOnly = tx({
      id: "tr3",
      type: "trade",
      week: 2,
      adds: {},
      drops: {},
      hasPicks: true,
      rosterIds: [1, 2],
    });
    const ledger = buildTradeLedger(1, [pickOnly], index, PLAYERS);
    expect(ledger.trades).toBe(1);
    expect(ledger.net).toBe(0);
    expect(ledger.anyPicks).toBe(true);
  });

  it("ignores a trade this roster was not part of", () => {
    const other = tx({
      id: "tr4",
      type: "trade",
      week: 2,
      adds: { c: 2 },
      drops: { c: 3 },
      rosterIds: [2, 3],
    });
    expect(buildTradeLedger(1, [other], index, PLAYERS).trades).toBe(0);
  });
});

describe("draft ledger", () => {
  const picks = [
    { draftId: "d1", pickNo: 1, round: 1, rosterId: 1, playerId: "a", isKeeper: false },
    { draftId: "d1", pickNo: 2, round: 1, rosterId: 2, playerId: "b", isKeeper: false },
    { draftId: "d1", pickNo: 3, round: 2, rosterId: 1, playerId: "c", isKeeper: false },
    { draftId: "d1", pickNo: 4, round: 2, rosterId: 2, playerId: "d", isKeeper: false },
  ];

  it("measures a pick against the mean of its own round in this draft", () => {
    const baselines = roundBaselines(picks, index);
    // Round 1: a scored 60, b scored 19. Mean 39.5.
    expect(baselines.get("d1|1")).toBe(39.5);
    // Round 2: c scored 13, d scored 0. Mean 6.5.
    expect(baselines.get("d1|2")).toBe(6.5);

    const one = buildDraftLedger(1, picks, baselines, index, PLAYERS);
    expect(one.picks).toBe(2);
    expect(one.points).toBe(73);
    expect(one.aboveBaseline).toBeCloseTo(60 - 39.5 + (13 - 6.5), 6);
  });

  it("sums to zero across the league, because the baseline is the league's own mean", () => {
    const baselines = roundBaselines(picks, index);
    const total =
      buildDraftLedger(1, picks, baselines, index, PLAYERS).aboveBaseline +
      buildDraftLedger(2, picks, baselines, index, PLAYERS).aboveBaseline;
    expect(total).toBeCloseTo(0, 6);
  });

  it("leaves keepers out of the baseline and out of the ledger", () => {
    const withKeeper = [
      ...picks,
      { draftId: "d1", pickNo: 5, round: 1, rosterId: 1, playerId: "a", isKeeper: true },
    ];
    const baselines = roundBaselines(withKeeper, index);
    // Unchanged: the keeper contributed to neither side of the mean.
    expect(baselines.get("d1|1")).toBe(39.5);
    expect(buildDraftLedger(1, withKeeper, baselines, index, PLAYERS).picks).toBe(2);
  });

  it("credits a drafted player who was later traded away to the roster that picked him", () => {
    // "a" was drafted by roster 1 and spent weeks 2 and 3 on roster 2. His
    // whole 60 still counts on roster 1's draft ledger; the trade ledger is
    // where the move itself is judged.
    const baselines = roundBaselines(picks, index);
    const one = buildDraftLedger(1, picks, baselines, index, PLAYERS);
    expect(one.best.find((m) => m.playerId === "a")?.points).toBe(60);
  });
  it("keeps a startup and a rookie draft in the same season apart", () => {
    // Round 1 of a 24-round startup is not the same question as round 1 of a
    // 4-round rookie draft. Bucketing on the round alone averaged the two
    // together and misgraded every pick in both.
    const twoDrafts = [
      { draftId: "startup", pickNo: 1, round: 1, rosterId: 1, playerId: "a", isKeeper: false },
      { draftId: "startup", pickNo: 2, round: 1, rosterId: 2, playerId: "b", isKeeper: false },
      { draftId: "rookie", pickNo: 1, round: 1, rosterId: 1, playerId: "c", isKeeper: false },
      { draftId: "rookie", pickNo: 2, round: 1, rosterId: 2, playerId: "d", isKeeper: false },
    ];
    const baselines = roundBaselines(twoDrafts, index);
    // startup round 1: a scored 60, b scored 19, mean 39.5.
    expect(baselines.get("startup|1")).toBe(39.5);
    // rookie round 1: c scored 13, d scored 0, mean 6.5.
    expect(baselines.get("rookie|1")).toBe(6.5);

    // Roster 1 took the best of each: +20.5 in the startup, +6.5 in the rookie.
    const one = buildDraftLedger(1, twoDrafts, baselines, index, PLAYERS);
    expect(one.aboveBaseline).toBeCloseTo(20.5 + 6.5, 6);
  });
});
