import { describe, it, expect } from "vitest";
import { computeDraftPulse } from "./draft-pulse";
import type { ProjectionBoard, PlayerProjection } from "./projection-board";
import type { PulsePosition } from "@/lib/power-pulse/types";

const DISPLAY = { min: 1, max: 99, sharpness: 1 };
const SLOTS = ["QB", "RB", "WR", "FLEX", "BN", "BN"];

/**
 * One player, flat across every week unless `only` restricts him. A week left
 * out is a bye, which the board represents by absence rather than by a zero.
 */
function player(
  playerId: string,
  position: PulsePosition,
  points: number,
  weeks: number[],
): PlayerProjection {
  return {
    playerId,
    position,
    weeks: weeks.map((week) => ({ week, points, sigma: points * 0.5, opponent: null, oppMult: 1 })),
    seasonPoints: points * weeks.length,
    pointsPerWeek: points,
    beatRate: null,
    reliability: 1,
    availability: null,
    ratioStdev: null,
    weeksPlayed: 0,
  };
}

function board(players: PlayerProjection[], weeks: number[]): ProjectionBoard {
  return {
    version: "test",
    scoringSignature: "test",
    season: 2026,
    fromWeek: 1,
    weeks,
    scoringBase: "pts_ppr",
    players: Object.fromEntries(players.map((p) => [p.playerId, p])),
  };
}

const ALL = [1, 2, 3, 4, 5, 6];
const REGULAR = [1, 2, 3, 4];

describe("throughWeek", () => {
  /**
   * The real shape of the bug: weeks past the regular season carry no NFL byes,
   * so including them fills a thin roster's lineup in exactly the weeks its
   * thinness would otherwise show. Team B here rests its only running back in
   * week 2 and has nobody behind him.
   */
  const deep = [
    player("a-qb", "QB", 20, ALL),
    player("a-rb", "RB", 12, ALL),
    player("a-wr", "WR", 12, ALL),
    player("a-rb2", "RB", 10, ALL),
  ];
  const thin = [
    player("b-qb", "QB", 20, ALL),
    player("b-rb", "RB", 12, [1, 3, 4, 5, 6]),
    player("b-wr", "WR", 12, ALL),
  ];
  const teams = [
    { rosterId: 1, playerIds: deep.map((p) => p.playerId) },
    { rosterId: 2, playerIds: thin.map((p) => p.playerId) },
  ];
  const b = board([...deep, ...thin], ALL);

  it("averages only the weeks the league actually plays", () => {
    const result = computeDraftPulse({
      teams,
      rosterPositions: SLOTS,
      fallbackSlots: [],
      board: b,
      display: DISPLAY,
      throughWeek: 4,
    });
    expect(result.weeks).toEqual(REGULAR);
  });

  it("stops the extra weeks from papering over a bye-week hole", () => {
    const trimmed = computeDraftPulse({
      teams,
      rosterPositions: SLOTS,
      fallbackSlots: [],
      board: b,
      display: DISPLAY,
      throughWeek: 4,
    });
    const untrimmed = computeDraftPulse({
      teams,
      rosterPositions: SLOTS,
      fallbackSlots: [],
      board: b,
      display: DISPLAY,
    });

    const gap = (r: ReturnType<typeof computeDraftPulse>) => {
      const [one, two] = r.teams;
      return one.meanStartingPoints - two.meanStartingPoints;
    };
    // Same rosters, same model. The only difference is how many weeks are in
    // the average, and the thin team looks closer to the deep one when the
    // bye-free weeks are included.
    expect(gap(trimmed)).toBeGreaterThan(gap(untrimmed));
  });

  it("uses every week on the board when no schedule is known", () => {
    const result = computeDraftPulse({
      teams,
      rosterPositions: SLOTS,
      fallbackSlots: [],
      board: b,
      display: DISPLAY,
    });
    expect(result.weeks).toEqual(ALL);
  });
});

describe("ranking", () => {
  it("separates two teams the display value rounds together", () => {
    // 40.00 against 39.96. Both render as 40.0, and ranking on the rendered
    // number would tie them, leaving a table with two firsts and no second in
    // whatever order the rows arrived.
    const players = [
      player("a1", "QB", 20, [1]),
      player("a2", "RB", 20, [1]),
      player("b1", "QB", 20, [1]),
      player("b2", "RB", 19.96, [1]),
    ];
    const result = computeDraftPulse({
      teams: [
        { rosterId: 1, playerIds: ["a1", "a2"] },
        { rosterId: 2, playerIds: ["b1", "b2"] },
      ],
      rosterPositions: ["QB", "RB", "BN"],
      fallbackSlots: [],
      board: board(players, [1]),
      display: DISPLAY,
      throughWeek: 1,
    });

    const [a, b] = result.teams;
    expect(a.meanStartingPoints).toBe(b.meanStartingPoints);
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(2);
  });
});

describe("startersFilled", () => {
  it("keeps enough precision for the grade curve to read it honestly", () => {
    // One unfilled slot in one week of six. 5/6 of the slots on average, which
    // is 0.8333 of the lineup: at one decimal that had collapsed onto a scale
    // with two values across a whole league.
    const players = [player("q", "QB", 20, ALL), player("r", "RB", 10, [1, 2, 3, 4, 5])];
    const result = computeDraftPulse({
      teams: [{ rosterId: 1, playerIds: ["q", "r"] }],
      rosterPositions: ["QB", "RB", "BN"],
      fallbackSlots: [],
      board: board(players, ALL),
      display: DISPLAY,
    });
    expect(result.teams[0].startersFilled).toBeCloseTo(1 + 5 / 6, 2);
  });
});
