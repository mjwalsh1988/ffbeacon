import { describe, it, expect } from "vitest";
import { applyLedgerRules, computeLedger, isLedgerSkip, median, type EngineInput } from "./engine";
import { DEFAULT_LEDGER_RULES, ledgerRulesFromSettings, type LedgerRules } from "./rules";
import type { LedgerPlayer } from "./lineup";
import type { LedgerResult } from "./types";

const PLAYERS: Map<string, LedgerPlayer> = new Map([
  ["qb", { sleeperId: "qb", name: "QB", position: "QB" }],
  ["rb1", { sleeperId: "rb1", name: "RB One", position: "RB" }],
  ["rb2", { sleeperId: "rb2", name: "RB Two", position: "RB" }],
]);

const POINTS = () =>
  new Map([
    ["qb", 20],
    ["rb1", 25],
    ["rb2", 5],
  ]);

/** Two rosters. Roster 1 starts its better back (45), roster 2 the worse (25). */
function input(weeksEach: number, rules?: Partial<LedgerRules>): EngineInput {
  const weeks: EngineInput["weeks"] = [];
  for (let week = 1; week <= weeksEach; week += 1) {
    weeks.push({
      week,
      sleeperRosterId: 1,
      officialPoints: 45,
      starterIds: ["qb", "rb1"],
      playerPoints: POINTS(),
      opponentPoints: 25,
      ineligibleIds: new Set<string>(),
      startedIds: new Set(["qb", "rb1"]),
    });
    weeks.push({
      week,
      sleeperRosterId: 2,
      officialPoints: 25,
      starterIds: ["qb", "rb2"],
      playerPoints: POINTS(),
      opponentPoints: 45,
      ineligibleIds: new Set<string>(),
      startedIds: new Set(["qb", "rb2"]),
    });
  }
  return {
    season: 2025,
    rosterPositions: ["QB", "RB", "BN"],
    rosters: [
      { sleeperRosterId: 1, teamName: "Sharp", ownerHandle: "sharp" },
      { sleeperRosterId: 2, teamName: "Asleep", ownerHandle: "asleep" },
    ],
    weeks,
    transactions: [],
    draftPicks: [],
    players: PLAYERS,
    leagueHasFaab: false,
    rules: rules ? { ...DEFAULT_LEDGER_RULES, ...rules } : undefined,
  };
}

function graded(value: ReturnType<typeof computeLedger>): LedgerResult {
  if (isLedgerSkip(value)) throw new Error(value.skipped);
  return value;
}

describe("ledgerRulesFromSettings", () => {
  it("reads playoffs, the median game and the league kind", () => {
    expect(ledgerRulesFromSettings({ type: 2, playoff_week_start: 15, league_average_match: 1 })).toEqual({
      kind: "dynasty",
      bestBall: false,
      chopped: false,
      playoffWeekStart: 15,
      medianGame: true,
    });
  });

  it("reads playoff_week_start 0 as no playoffs", () => {
    expect(ledgerRulesFromSettings({ playoff_week_start: 0 }).playoffWeekStart).toBeNull();
  });

  it("gives a chopped league no playoffs and no median game", () => {
    const rules = ledgerRulesFromSettings({ type: 3, playoff_week_start: 15, league_average_match: 1 });
    expect(rules.chopped).toBe(true);
    expect(rules.playoffWeekStart).toBeNull();
    expect(rules.medianGame).toBe(false);
  });

  it("marks a best ball league", () => {
    expect(ledgerRulesFromSettings({ type: 0, best_ball: 1 }).bestBall).toBe(true);
  });
});

describe("median", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("computeLedger under league rules", () => {
  it("counts the regular season only in the record and the scoring rank", () => {
    const result = graded(computeLedger(input(4, { playoffWeekStart: 4 })));
    const [sharp] = result.teams;
    expect(sharp.lineup.actualRecord).toEqual({ wins: 3, losses: 0, ties: 0 });
    expect(sharp.lineup.weeks.find((w) => w.week === 4)?.playoff).toBe(true);
    // Efficiency still reads every settled week, playoffs included.
    expect(sharp.lineup.weeksGraded).toBe(4);
  });

  it("adds the median game, and counts a median loss the bench would have won", () => {
    const result = graded(computeLedger(input(3, { medianGame: true })));
    const asleep = result.teams.find((t) => t.sleeperRosterId === 2)!;
    // Median of 45 and 25 is 35. Lost both games every week.
    expect(asleep.lineup.actualRecord).toEqual({ wins: 0, losses: 6, ties: 0 });
    // Best lineup 45: a tie head to head, a win over the median.
    expect(asleep.lineup.bestLineupRecord).toEqual({ wins: 3, losses: 0, ties: 3 });
    expect(asleep.lineup.winsLeftOnBench).toBe(3);
    expect(asleep.lineup.weeks[0]).toMatchObject({ medianPoints: 35, medianOutcome: "loss" });
  });

  it("grades a chopped week against the cut line and drops a team already cut", () => {
    const base = input(2);
    // A third roster, chopped after week 1: in week 2 it starts nobody.
    const weeks: EngineInput["weeks"] = [
      ...base.weeks.map((w) => ({ ...w, opponentPoints: null })),
      {
        week: 1,
        sleeperRosterId: 3,
        officialPoints: 10,
        starterIds: ["qb", "rb2"],
        playerPoints: POINTS(),
        opponentPoints: null,
        ineligibleIds: new Set<string>(),
        startedIds: new Set(["qb", "rb2"]),
      },
      {
        week: 2,
        sleeperRosterId: 3,
        officialPoints: 0,
        starterIds: ["0", "0"],
        playerPoints: new Map(),
        opponentPoints: null,
        ineligibleIds: new Set<string>(),
        startedIds: new Set(),
      },
    ];
    const result = graded(
      computeLedger({
        ...base,
        weeks,
        rosters: [...base.rosters, { sleeperRosterId: 3, teamName: "Cut", ownerHandle: null }],
        rules: { ...DEFAULT_LEDGER_RULES, kind: "chopped", chopped: true },
      }),
    );
    const cut = result.teams.find((t) => t.sleeperRosterId === 3)!;
    // Week 1 only: 10 against a cut line of 25, below it. Week 2 is not graded.
    expect(cut.lineup.weeksGraded).toBe(1);
    expect(cut.lineup.actualRecord).toEqual({ wins: 0, losses: 1, ties: 0 });
    // Its best lineup (45) would have cleared the 25 cut line.
    expect(cut.lineup.winsLeftOnBench).toBe(1);

    const asleep = result.teams.find((t) => t.sleeperRosterId === 2)!;
    // Week 1: 25 over a cut line of 10. Week 2: 25 under 45, the lowest live score.
    expect(asleep.lineup.actualRecord).toEqual({ wins: 1, losses: 1, ties: 0 });
  });

  it("does no lineup grading in best ball and keeps the record", () => {
    const result = graded(
      computeLedger(input(3, { kind: "best-ball-redraft", bestBall: true })),
    );
    const asleep = result.teams.find((t) => t.sleeperRosterId === 2)!;
    expect(asleep.lineup.efficiency).toBeNull();
    expect(asleep.efficiencyRank).toBeNull();
    expect(asleep.lineup.winsLeftOnBench).toBe(0);
    expect(asleep.lineup.pointsLeft).toBe(0);
    expect(asleep.lineup.actualRecord).toEqual({ wins: 0, losses: 3, ties: 0 });
    expect(asleep.lineup.bestLineupRecord).toEqual(asleep.lineup.actualRecord);
    expect(asleep.lineup.weeks.every((w) => w.biggestMiss === null)).toBe(true);
    expect(asleep.scoringRank).toBe(2);
  });
});

describe("applyLedgerRules", () => {
  it("leaves an ordinary league's weeks as they were", () => {
    const weeks = input(1).weeks;
    expect(applyLedgerRules(weeks, DEFAULT_LEDGER_RULES)).toEqual(weeks);
  });
});
