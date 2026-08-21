import { describe, it, expect } from "vitest";
import {
  buildLuckRows,
  buildSosRows,
  easiestStretch,
  headToHeadCounts,
  toughestStretch,
  weekSpotlight,
  type InsightWeek,
} from "./insights";
import type { ScheduleMatchup, ScheduleMatchupSide, ScheduleTeam } from "./types";

const NAMES: Record<number, string> = { 1: "Anchors", 2: "Beacons", 3: "Comets", 4: "Drifters" };

function team(
  rosterId: number,
  record: [number, number, number],
  pointsFor: number,
  sos: { points: number | null; rank: number | null } = { points: null, rank: null },
): ScheduleTeam {
  return {
    sleeperRosterId: rosterId,
    rosterRowId: `r-${rosterId}`,
    teamName: NAMES[rosterId],
    ownerHandle: null,
    ownerAvatarId: null,
    record: { wins: record[0], losses: record[1], ties: record[2] },
    pointsFor,
    pulseRank: null,
    sosPoints: sos.points,
    sosRank: sos.rank,
  };
}

function matchupSide(
  rosterId: number,
  opts: { actual?: number | null; projectedOptimal?: number | null; won?: boolean } = {},
): ScheduleMatchupSide {
  return {
    sleeperRosterId: rosterId,
    teamName: NAMES[rosterId] ?? `Team ${rosterId}`,
    ownerHandle: null,
    ownerAvatarId: null,
    record: { wins: 0, losses: 0, ties: 0 },
    pulseRank: null,
    actual: opts.actual ?? null,
    projectedOptimal: opts.projectedOptimal ?? null,
    sigma: null,
    pointsLeftOnBench: null,
    won: opts.won ?? false,
  };
}

function finalGame(
  week: number,
  home: [number, number],
  away: [number, number],
): ScheduleMatchup {
  return {
    matchupId: home[0],
    week,
    isFinal: true,
    home: matchupSide(home[0], { actual: home[1], won: home[1] > away[1] }),
    away: matchupSide(away[0], { actual: away[1], won: away[1] > home[1] }),
    homeWinProb: null,
  };
}

/**
 * A whole four-team, two-week season, worked out by hand in the assertions
 * below. Week 1: Anchors 100 beat Beacons 90, Comets 120 beat Drifters 80.
 * Week 2: Comets 110 beat Anchors 70, Beacons 95 beat Drifters 85.
 */
const SEASON: InsightWeek[] = [
  { week: 1, isFinal: true, matchups: [finalGame(1, [1, 100], [2, 90]), finalGame(1, [3, 120], [4, 80])] },
  { week: 2, isFinal: true, matchups: [finalGame(2, [3, 110], [1, 70]), finalGame(2, [2, 95], [4, 85])] },
];

const TEAMS: ScheduleTeam[] = [
  team(1, [1, 1, 0], 170, { points: 108.2, rank: 1 }),
  team(2, [1, 1, 0], 185, { points: 104.5, rank: 2 }),
  team(3, [2, 0, 0], 230, { points: 99.1, rank: 3 }),
  team(4, [0, 2, 0], 165, { points: 96.7, rank: 4 }),
];

describe("buildSosRows", () => {
  it("passes the remaining schedule through from the Power Pulse cache untouched", () => {
    const rows = buildSosRows(TEAMS, SEASON);
    expect(rows.map((r) => r.remainingPoints)).toEqual([108.2, 104.5, 99.1, 96.7]);
    expect(rows.map((r) => r.remainingRank)).toEqual([1, 2, 3, 4]);
  });

  it("averages the actual scores of the opponents already faced", () => {
    const rows = buildSosRows(TEAMS, SEASON);
    // Anchors faced Beacons (90) and Comets (110).
    expect(rows[0].playedPoints).toBeCloseTo(100, 5);
    // Beacons faced Anchors (100) and Drifters (85).
    expect(rows[1].playedPoints).toBeCloseTo(92.5, 5);
    // Comets faced Drifters (80) and Anchors (70).
    expect(rows[2].playedPoints).toBeCloseTo(75, 5);
    // Drifters faced Comets (120) and Beacons (95).
    expect(rows[3].playedPoints).toBeCloseTo(107.5, 5);
  });

  it("ranks the hardest schedule so far first", () => {
    const rows = buildSosRows(TEAMS, SEASON);
    expect(rows.map((r) => r.playedRank)).toEqual([2, 3, 4, 1]);
  });

  it("reports no played strength of schedule before any games", () => {
    const upcoming: InsightWeek[] = [
      { week: 1, isFinal: false, matchups: [finalGame(1, [1, 0], [2, 0])] },
    ];
    upcoming[0].matchups[0].isFinal = false;
    const rows = buildSosRows(TEAMS, upcoming);
    expect(rows.every((r) => r.playedPoints === null)).toBe(true);
    expect(rows.every((r) => r.playedRank === null)).toBe(true);
  });
});

describe("buildLuckRows", () => {
  it("scores every team against every other team's score, week by week", () => {
    const rows = buildLuckRows(TEAMS, SEASON);
    const byId = new Map(rows.map((r) => [r.sleeperRosterId, r]));

    // Anchors: week 1 they beat 90 and 80 and lost to 120; week 2 their 70 was
    // the lowest score on the board. Two wins, four losses.
    expect(byId.get(1)?.allPlayWins).toBe(2);
    expect(byId.get(1)?.allPlayLosses).toBe(4);
    // Beacons: beat 80 in week 1, beat 70 and 85 in week 2.
    expect(byId.get(2)?.allPlayWins).toBe(3);
    expect(byId.get(2)?.allPlayLosses).toBe(3);
    // Comets: top score both weeks.
    expect(byId.get(3)?.allPlayWins).toBe(6);
    expect(byId.get(3)?.allPlayLosses).toBe(0);
    // Drifters: one win, over the Anchors' 70 in week 2.
    expect(byId.get(4)?.allPlayWins).toBe(1);
    expect(byId.get(4)?.allPlayLosses).toBe(5);
  });

  it("calls the 1-1 team with the second worst all-play record the lucky one", () => {
    const rows = buildLuckRows(TEAMS, SEASON);
    const byId = new Map(rows.map((r) => [r.sleeperRosterId, r]));
    // Real 0.500 against an all-play 0.333.
    expect(byId.get(1)?.luck).toBeCloseTo(1 / 2 - 2 / 6, 6);
    expect(byId.get(2)?.luck).toBeCloseTo(0, 6);
    expect(byId.get(3)?.luck).toBeCloseTo(0, 6);
    expect(byId.get(4)?.luck).toBeCloseTo(0 - 1 / 6, 6);
    expect(byId.get(1)?.luckRank).toBe(1);
    // Beacons and Comets are both exactly as lucky as their scores deserve.
    expect(byId.get(2)?.luckRank).toBe(2);
    expect(byId.get(3)?.luckRank).toBe(2);
    expect(byId.get(4)?.luckRank).toBe(4);
  });

  it("ranks by points scored alongside the luck rank", () => {
    const rows = buildLuckRows(TEAMS, SEASON);
    expect(rows.map((r) => r.pointsRank)).toEqual([3, 2, 1, 4]);
  });

  it("counts a tied week as half a win on both sides", () => {
    const tied: InsightWeek[] = [
      { week: 1, isFinal: true, matchups: [finalGame(1, [1, 100], [2, 100])] },
    ];
    const two = [team(1, [0, 0, 1], 100), team(2, [0, 0, 1], 100)];
    const rows = buildLuckRows(two, tied);
    expect(rows[0].allPlayWins).toBe(0.5);
    expect(rows[0].allPlayLosses).toBe(0.5);
    expect(rows[0].luck).toBeCloseTo(0, 6);
  });

  it("returns nothing before a single week is final", () => {
    expect(buildLuckRows(TEAMS, [{ week: 1, isFinal: false, matchups: [] }])).toEqual([]);
  });
});

describe("weekSpotlight", () => {
  function upcoming(week: number, probs: (number | null)[]): InsightWeek {
    return {
      week,
      isFinal: false,
      matchups: probs.map((p, i) => ({
        matchupId: i + 1,
        week,
        isFinal: false,
        home: matchupSide(i * 2 + 1),
        away: matchupSide(i * 2 + 2),
        homeWinProb: p,
      })),
    };
  }

  it("picks the game nearest a coin flip and the one furthest from it", () => {
    const spotlight = weekSpotlight(upcoming(4, [0.7, 0.52, 0.95]));
    expect(spotlight.week).toBe(4);
    expect(spotlight.closest?.homeWinProb).toBe(0.52);
    expect(spotlight.mismatch?.homeWinProb).toBe(0.95);
  });

  it("measures distance from a half in both directions", () => {
    const spotlight = weekSpotlight(upcoming(4, [0.55, 0.08]));
    expect(spotlight.closest?.homeWinProb).toBe(0.55);
    expect(spotlight.mismatch?.homeWinProb).toBe(0.08);
  });

  it("reports nothing when no matchup carries a win probability", () => {
    const spotlight = weekSpotlight(upcoming(4, [null, null]));
    expect(spotlight.closest).toBeNull();
    expect(spotlight.mismatch).toBeNull();
  });
});

describe("stretches", () => {
  function remaining(week: number, opponentPoints: number | null): InsightWeek {
    return {
      week,
      isFinal: false,
      matchups: [
        {
          matchupId: 1,
          week,
          isFinal: false,
          home: matchupSide(1),
          away: matchupSide(2, { projectedOptimal: opponentPoints }),
          homeWinProb: null,
        },
      ],
    };
  }

  const FOUR_WEEKS = [remaining(3, 100), remaining(4, 120), remaining(5, 110), remaining(6, 90)];

  it("finds the hardest three-week run by average opponent projection", () => {
    const stretch = toughestStretch(1, FOUR_WEEKS);
    expect(stretch).toEqual({ startWeek: 3, endWeek: 5, opponentPoints: 110 });
  });

  it("finds the softest run with the same window", () => {
    const stretch = easiestStretch(1, FOUR_WEEKS);
    expect(stretch?.startWeek).toBe(4);
    expect(stretch?.endWeek).toBe(6);
    expect(stretch?.opponentPoints).toBeCloseTo((120 + 110 + 90) / 3, 6);
  });

  it("returns null at the season boundary, when fewer weeks remain than the window", () => {
    expect(toughestStretch(1, FOUR_WEEKS.slice(0, 2))).toBeNull();
    expect(easiestStretch(1, FOUR_WEEKS.slice(0, 2))).toBeNull();
  });

  it("returns null when the opponents carry no projection", () => {
    const noProjections = [remaining(3, null), remaining(4, null), remaining(5, null)];
    expect(toughestStretch(1, noProjections)).toBeNull();
  });

  it("ignores weeks already played", () => {
    const mixed: InsightWeek[] = [
      { ...remaining(1, 200), isFinal: true },
      remaining(3, 100),
      remaining(4, 120),
      remaining(5, 110),
    ];
    expect(toughestStretch(1, mixed)?.startWeek).toBe(3);
  });

  it("honours a custom window size", () => {
    const stretch = toughestStretch(1, FOUR_WEEKS, 2);
    expect(stretch).toEqual({ startWeek: 4, endWeek: 5, opponentPoints: 115 });
  });
});

describe("headToHeadCounts", () => {
  it("lists only the opponents a team meets more than once", () => {
    const weeks: InsightWeek[] = [
      { week: 1, isFinal: true, matchups: [finalGame(1, [1, 100], [2, 90])] },
      { week: 2, isFinal: true, matchups: [finalGame(2, [3, 110], [1, 70])] },
      { week: 3, isFinal: true, matchups: [finalGame(3, [1, 95], [4, 88])] },
      { week: 4, isFinal: true, matchups: [finalGame(4, [2, 91], [1, 105])] },
    ];
    const counts = headToHeadCounts(1, weeks, TEAMS);
    expect(counts).toHaveLength(1);
    expect(counts[0].opponentRosterId).toBe(2);
    expect(counts[0].opponentName).toBe("Beacons");
    expect(counts[0].meetings).toEqual([1, 4]);
  });

  it("sorts by meetings, then by team name", () => {
    const weeks: InsightWeek[] = [
      { week: 1, isFinal: true, matchups: [finalGame(1, [1, 1], [4, 0])] },
      { week: 2, isFinal: true, matchups: [finalGame(2, [1, 1], [4, 0])] },
      { week: 3, isFinal: true, matchups: [finalGame(3, [1, 1], [4, 0])] },
      { week: 4, isFinal: true, matchups: [finalGame(4, [1, 1], [2, 0])] },
      { week: 5, isFinal: true, matchups: [finalGame(5, [1, 1], [2, 0])] },
      { week: 6, isFinal: true, matchups: [finalGame(6, [1, 1], [3, 0])] },
      { week: 7, isFinal: true, matchups: [finalGame(7, [1, 1], [3, 0])] },
    ];
    const counts = headToHeadCounts(1, weeks, TEAMS);
    expect(counts.map((c) => c.opponentName)).toEqual(["Drifters", "Beacons", "Comets"]);
  });

  it("returns nothing when every opponent is met once", () => {
    expect(headToHeadCounts(1, SEASON, TEAMS)).toEqual([]);
  });
});
