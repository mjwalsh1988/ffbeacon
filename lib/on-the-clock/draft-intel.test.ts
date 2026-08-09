import { describe, it, expect } from "vitest";
import { orderByAdp, simulateRemainingDraft, survivorsAt, goneBefore, nextPickForRoster } from "./adp-sim";
import { buildMarketCurve, computePickSurplus, marketValueAt, surplusByRoster } from "./surplus";
import { detectRun, detectTierCliffs, turnAlert } from "./draft-alerts";
import { computeDraftPulse, fallbackSlotsFromDraftSettings } from "./draft-pulse";
import { computeDraftGrades, letterFor } from "./draft-grade";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "./default-settings";
import type { RankedPlayer } from "./board-types";
import type { CurrentDraftPick } from "./pick-ownership";
import type { ShapedPick } from "./types";
import type { ProjectionBoard } from "./projection-board";
import type { TeamRollup } from "./rosters";

let seq = 0;
function rp(over: Partial<RankedPlayer> = {}): RankedPlayer {
  seq += 1;
  return {
    playerId: over.playerId ?? `p${seq}`,
    sleeperId: over.sleeperId ?? `s${seq}`,
    name: over.name ?? `Player ${seq}`,
    position: "WR",
    team: "ATL",
    overallRank: seq,
    positionRank: 1,
    tier: 1,
    value: 1000,
    isRookie: false,
    ...over,
  };
}

function cp(over: Partial<CurrentDraftPick> & { overall: number }): CurrentDraftPick {
  return {
    round: 1,
    pickInRound: over.overall,
    slot: over.overall,
    originalRosterId: 1,
    currentOwnerRosterId: 1,
    ownershipKnown: true,
    made: false,
    madePick: null,
    ...over,
  };
}

function sp(over: Partial<ShapedPick> & { pickNo: number }): ShapedPick {
  return {
    round: 1,
    draftSlot: 1,
    rosterId: 1,
    pickedBy: "u1",
    sleeperPlayerId: null,
    playerId: null,
    isKeeper: false,
    firstName: "First",
    lastName: `L${over.pickNo}`,
    position: "WR",
    team: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("orderByAdp", () => {
  it("takes the market's order, not the board's", () => {
    // The board loves p1; the market does not. The market wins here, because the
    // question is who will be GONE, not who is best.
    const board = [
      rp({ playerId: "p1", overallRank: 1, adp: 40 }),
      rp({ playerId: "p2", overallRank: 20, adp: 2 }),
    ];
    expect(orderByAdp(board).map((o) => o.player.playerId)).toEqual(["p2", "p1"]);
  });

  it("places a player with no ADP by rank and says the placement is inferred", () => {
    const board = [rp({ playerId: "noAdp", overallRank: 5, adp: null }), rp({ playerId: "hasAdp", adp: 30 })];
    const ordered = orderByAdp(board);
    expect(ordered.map((o) => o.player.playerId)).toEqual(["noAdp", "hasAdp"]);
    expect(ordered[0].adpKnown).toBe(false);
    expect(ordered[1].adpKnown).toBe(true);
  });
});

describe("simulateRemainingDraft", () => {
  const board = [
    rp({ playerId: "a", adp: 1 }),
    rp({ playerId: "b", adp: 2 }),
    rp({ playerId: "c", adp: 3 }),
  ];
  const picks = [
    cp({ overall: 1, made: true }),
    cp({ overall: 2 }),
    cp({ overall: 3, currentOwnerRosterId: 2 }),
    cp({ overall: 4 }),
  ];

  it("fills only the unmade picks, from the clock forward", () => {
    const sim = simulateRemainingDraft({ available: board, currentPicks: picks, onTheClockPickNo: 2 });
    expect([...sim.keys()].sort((x, y) => x - y)).toEqual([2, 3, 4]);
    expect(sim.get(2)?.player.playerId).toBe("a");
    expect(sim.get(4)?.player.playerId).toBe("c");
  });

  it("leaves picks past the end of the board empty rather than inventing players", () => {
    const sim = simulateRemainingDraft({
      available: [rp({ playerId: "only", adp: 1 })],
      currentPicks: picks,
      onTheClockPickNo: 2,
    });
    expect(sim.size).toBe(1);
    expect(sim.has(4)).toBe(false);
  });

  it("answers who survives and who is gone by a given pick", () => {
    const sim = simulateRemainingDraft({ available: board, currentPicks: picks, onTheClockPickNo: 2 });
    expect(survivorsAt(board, sim, 4).map((p) => p.playerId)).toEqual(["c"]);
    expect(goneBefore(sim, 4).map((p) => p.playerId).sort()).toEqual(["a", "b"]);
  });
});

describe("nextPickForRoster", () => {
  it("follows current ownership, so a traded-away pick is not yours", () => {
    const picks = [cp({ overall: 5, currentOwnerRosterId: 2 }), cp({ overall: 9, currentOwnerRosterId: 1 })];
    expect(nextPickForRoster(picks, 1, 1)?.overall).toBe(9);
  });

  it("returns null when the roster has nothing left", () => {
    expect(nextPickForRoster([cp({ overall: 3, made: true })], 1, 1)).toBeNull();
    expect(nextPickForRoster([cp({ overall: 3 })], null, 1)).toBeNull();
  });
});

describe("market curve and surplus", () => {
  const board = [
    rp({ playerId: "top", sleeperId: "st", value: 5000, adp: 1 }),
    rp({ playerId: "mid", sleeperId: "sm", value: 2000, adp: 10 }),
    rp({ playerId: "low", sleeperId: "sl", value: 500, adp: 30 }),
  ];

  it("prices each slot at what the market expects there", () => {
    const curve = buildMarketCurve(board);
    expect(marketValueAt(curve, 1)).toBe(5000);
    expect(marketValueAt(curve, 2)).toBe(2000);
    // Past the end, the slot is worth the cheapest priced player rather than zero.
    expect(marketValueAt(curve, 99)).toBe(500);
  });

  it("keeps the curve non-increasing so one over-loved player is not a bump", () => {
    const bumpy = [
      rp({ playerId: "a", value: 100, adp: 1 }),
      rp({ playerId: "b", value: 9000, adp: 2 }),
    ];
    const curve = buildMarketCurve(bumpy);
    expect(curve.values[1]).toBeLessThanOrEqual(curve.values[0]);
  });

  it("credits value over the slot price and excludes keepers", () => {
    const curve = buildMarketCurve(board);
    const picks = [
      // The 5000 player at slot 2, priced 2000: +3000.
      sp({ pickNo: 2, rosterId: 1, sleeperPlayerId: "st" }),
      // A keeper, which is assigned rather than chosen, so it is not graded.
      sp({ pickNo: 3, rosterId: 1, sleeperPlayerId: "sm", isKeeper: true }),
    ];
    const surpluses = computePickSurplus({
      picks,
      valueByPlayerId: new Map(),
      valueBySleeperId: new Map(board.map((p) => [p.sleeperId as string, p.value])),
      curve,
    });
    expect(surpluses).toHaveLength(1);
    expect(surpluses[0].surplus).toBe(3000);
    expect(surplusByRoster(surpluses).get(1)).toEqual({ total: 3000, count: 1, average: 3000 });
  });
});

describe("draft alerts", () => {
  it("calls a run only when enough of the recent picks share a position", () => {
    const picks = [1, 2, 3, 4].map((n) => sp({ pickNo: n, position: "RB" }));
    expect(detectRun(picks, { window: 8, threshold: 4 })?.message).toContain("running backs");
    expect(detectRun(picks, { window: 8, threshold: 5 })).toBeNull();
  });

  it("re-announces when a run extends but not while it sits still", () => {
    const four = [1, 2, 3, 4].map((n) => sp({ pickNo: n, position: "WR" }));
    const five = [...four, sp({ pickNo: 5, position: "WR" })];
    const a = detectRun(four, { window: 8, threshold: 4 });
    const b = detectRun(four.slice().reverse(), { window: 8, threshold: 4 });
    const c = detectRun(five, { window: 8, threshold: 4 });
    expect(a?.id).toBe(b?.id);
    expect(a?.id).not.toBe(c?.id);
  });

  it("warns on a thin tier and never on kickers", () => {
    const board = [
      rp({ position: "WR", tier: 1 }),
      rp({ position: "WR", tier: 2 }),
      rp({ position: "K", tier: 1 }),
    ];
    const alerts = detectTierCliffs(board, { remaining: 2 });
    expect(alerts.map((a) => a.position)).toEqual(["WR"]);
  });

  it("stays quiet about a turn that is far away", () => {
    expect(turnAlert(20, 40)).toBeNull();
    expect(turnAlert(0, 12)?.message).toContain("on the clock");
    expect(turnAlert(3, 15)?.message).toContain("3 picks");
    expect(turnAlert(null, null)).toBeNull();
  });

  it("re-announces on the next turn rather than once per draft", () => {
    // Keyed on the countdown alone, "you are on the clock" would fire once and
    // then never again, because the radar only announces ids it has not seen.
    expect(turnAlert(0, 12)?.id).not.toBe(turnAlert(0, 25)?.id);
  });
});

describe("computeDraftPulse", () => {
  const board: ProjectionBoard = {
    version: "test",
    scoringSignature: "t",
    season: 2026,
    fromWeek: 1,
    weeks: [1, 2],
    scoringBase: "pts_ppr",
    players: {
      good: {
        playerId: "good",
        position: "RB",
        weeks: [
          { week: 1, points: 20, sigma: 5, opponent: null, oppMult: 1 },
          { week: 2, points: 20, sigma: 5, opponent: null, oppMult: 1 },
        ],
        seasonPoints: 40,
        pointsPerWeek: 20,
        beatRate: 0.7,
        reliability: 1,
        availability: 0.9,
        ratioStdev: 0.3,
        weeksPlayed: 30,
      },
      poor: {
        playerId: "poor",
        position: "RB",
        weeks: [
          { week: 1, points: 5, sigma: 2, opponent: null, oppMult: 1 },
          { week: 2, points: 5, sigma: 2, opponent: null, oppMult: 1 },
        ],
        seasonPoints: 10,
        pointsPerWeek: 5,
        beatRate: 0.3,
        reliability: 1,
        availability: 0.5,
        ratioStdev: 0.6,
        weeksPlayed: 30,
      },
    },
  };

  it("ranks by projected starting points and never claims wins or odds", () => {
    const result = computeDraftPulse({
      teams: [
        { rosterId: 1, playerIds: ["good"] },
        { rosterId: 2, playerIds: ["poor"] },
      ],
      rosterPositions: ["RB", "BN"],
      fallbackSlots: ["RB"],
      board,
      display: { min: 1, max: 99, sharpness: 1 },
    });
    expect(result.teams.find((t) => t.rosterId === 1)?.rank).toBe(1);
    expect(result.teams.find((t) => t.rosterId === 1)?.meanStartingPoints).toBe(20);
    expect(result.slotsEstimated).toBe(false);
    // The shape carries no wins, playoff odds, or projected finish at all.
    expect(Object.keys(result.teams[0])).not.toContain("expectedWins");
    expect(Object.keys(result.teams[0])).not.toContain("playoffOdds");
  });

  it("reports an empty team as zero rather than pretending it has a lineup", () => {
    const result = computeDraftPulse({
      teams: [{ rosterId: 1, playerIds: [] }],
      rosterPositions: ["RB"],
      fallbackSlots: ["RB"],
      board,
      display: { min: 1, max: 99, sharpness: 1 },
    });
    expect(result.teams[0].meanStartingPoints).toBe(0);
    expect(result.teams[0].projectedCount).toBe(0);
  });

  it("flags an inferred slot list when the league object was never captured", () => {
    const result = computeDraftPulse({
      teams: [{ rosterId: 1, playerIds: ["good"] }],
      rosterPositions: [],
      fallbackSlots: fallbackSlotsFromDraftSettings({ slots_rb: 1 }),
      board,
      display: { min: 1, max: 99, sharpness: 1 },
    });
    expect(result.slotsEstimated).toBe(true);
    expect(result.slots).toEqual(["RB"]);
  });
});

describe("computeDraftGrades", () => {
  function rollup(over: Partial<TeamRollup> & { rosterId: number }): TeamRollup {
    return {
      ownerName: `Owner ${over.rosterId}`,
      teamName: null,
      isYou: false,
      players: { QB: [], RB: [], WR: [], TE: [] },
      positionTotals: { QB: 0, RB: 0, WR: 0, TE: 0 },
      playersValue: 1000,
      playerCount: 5,
      futurePicks: [],
      futurePicksValue: 0,
      totalValue: 1000,
      rank: 1,
      ...over,
    };
  }

  it("drops a component with no data and redistributes its weight", () => {
    const grades = computeDraftGrades({
      rollups: [rollup({ rosterId: 1 }), rollup({ rosterId: 2, rank: 2 })],
      pulseTeams: [],
      pickSurpluses: [],
      tradeMarginByRoster: new Map(),
      startingSlotCount: 0,
      isDynasty: false,
      settings: DEFAULT_ON_THE_CLOCK_SETTINGS.grades,
      inProgress: false,
    });
    const grade = grades[0];
    // Nothing had data, so nothing carries weight and the omissions are named.
    expect(grade.components).toHaveLength(0);
    expect(grade.omitted.map((o) => o.key)).toContain("lineup");
    expect(grade.omitted.find((o) => o.key === "future")?.why).toContain("redraft");
  });

  it("weights the surviving components to one", () => {
    const grades = computeDraftGrades({
      rollups: [rollup({ rosterId: 1 }), rollup({ rosterId: 2, rank: 2 })],
      pulseTeams: [],
      pickSurpluses: [
        {
          pickNo: 1,
          rosterId: 1,
          playerId: "a",
          playerName: "A",
          position: "WR",
          value: 3000,
          marketValue: 1000,
          surplus: 2000,
        },
        {
          pickNo: 2,
          rosterId: 2,
          playerId: "b",
          playerName: "B",
          position: "WR",
          value: 500,
          marketValue: 1000,
          surplus: -500,
        },
      ],
      tradeMarginByRoster: new Map(),
      startingSlotCount: 0,
      isDynasty: false,
      settings: DEFAULT_ON_THE_CLOCK_SETTINGS.grades,
      inProgress: false,
    });
    const total = grades[0].components.reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBeCloseTo(1, 2);
    // The team that beat the market outranks the one that paid over it.
    expect(grades[0].rosterId).toBe(1);
    expect(grades[0].bestPick?.playerName).toBe("A");
    expect(grades[1].worstPick?.playerName).toBe("B");
  });
});

describe("letterFor", () => {
  it("maps the ends and the middle", () => {
    expect(letterFor(97)).toBe("A+");
    expect(letterFor(73)).toBe("B");
    expect(letterFor(58)).toBe("C");
    expect(letterFor(10)).toBe("F");
  });
});
