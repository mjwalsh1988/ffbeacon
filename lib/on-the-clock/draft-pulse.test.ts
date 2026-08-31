import { describe, it, expect } from "vitest";
import { computeDraftPulse } from "./draft-pulse";
import { regularSeasonThroughWeek } from "./pulse-service";
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
    weeks: weeks.map((week) => ({
      week,
      points,
      sigma: points * 0.5,
      opponent: null,
      oppMult: 1,
    })),
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
    const players = [
      player("q", "QB", 20, ALL),
      player("r", "RB", 10, [1, 2, 3, 4, 5]),
    ];
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

describe("regularSeasonThroughWeek", () => {
  it("reads a normal league literally", () => {
    expect(regularSeasonThroughWeek(15)).toBe(14);
    expect(regularSeasonThroughWeek(14)).toBe(13);
    expect(regularSeasonThroughWeek(16)).toBe(15);
  });

  it("treats zero as no playoffs rather than as week zero", () => {
    // Four synced leagues store 0: a guillotine, a best ball, a bracket league
    // and a knockout. Read literally that is a through-week of -1, which filters
    // every week out of the average and scores every team in the league zero.
    expect(regularSeasonThroughWeek(0)).toBe(14);
  });

  it("survives every other shape Sleeper can hand back", () => {
    expect(regularSeasonThroughWeek(null)).toBe(14);
    expect(regularSeasonThroughWeek(undefined)).toBe(14);
    expect(regularSeasonThroughWeek(Number.NaN)).toBe(14);
    expect(regularSeasonThroughWeek(-3)).toBe(14);
    // 1 would mean the regular season ends before it starts.
    expect(regularSeasonThroughWeek(1)).toBe(14);
  });

  it("does not leave a league with an empty week set", () => {
    for (const pws of [0, 1, -5, null, undefined, Number.NaN, 14, 15, 18]) {
      expect(
        regularSeasonThroughWeek(pws),
        `playoff_week_start=${pws}`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("an empty starting slot, which is not worth zero", () => {
  const SF_SLOTS = ["QB", "RB", "WR", "TE", "BN"];

  /**
   * The Sunday Funday case. Two teams identical except that one drafted no
   * tight end, in a league where several playable tight ends are unrostered.
   */
  const shared = [
    player("a-qb", "QB", 20, ALL),
    player("a-rb", "RB", 14, ALL),
    player("a-wr", "WR", 14, ALL),
    player("b-qb", "QB", 20, ALL),
    player("b-rb", "RB", 14, ALL),
    player("b-wr", "WR", 14, ALL),
  ];
  const withTe = player("a-te", "TE", 9, ALL);
  const freeAgents = [
    player("fa-te1", "TE", 8, ALL),
    player("fa-te2", "TE", 7, ALL),
  ];

  const teams = [
    { rosterId: 1, playerIds: ["a-qb", "a-rb", "a-wr", "a-te"] },
    { rosterId: 2, playerIds: ["b-qb", "b-rb", "b-wr"] },
  ];
  const b = board([...shared, withTe, ...freeAgents], ALL);
  const owned = new Set(teams.flatMap((t) => t.playerIds));

  const run = (rosteredPlayerIds?: Set<string>) =>
    computeDraftPulse({
      teams,
      rosterPositions: SF_SLOTS,
      fallbackSlots: [],
      board: b,
      display: DISPLAY,
      throughWeek: 6,
      rosteredPlayerIds,
    });

  it("used to cost a whole tight end and now costs the difference between two", () => {
    const before = run();
    const after = run(owned);
    const gapBefore =
      before.teams.find((t) => t.rosterId === 1)!.meanStartingPoints -
      before.teams.find((t) => t.rosterId === 2)!.meanStartingPoints;
    const gapAfter =
      after.teams.find((t) => t.rosterId === 1)!.meanStartingPoints -
      after.teams.find((t) => t.rosterId === 2)!.meanStartingPoints;

    // Nine points a week, the whole slot, against one point: the difference
    // between the tight end drafted and the best one still on the wire.
    expect(gapBefore).toBeCloseTo(9, 1);
    expect(gapAfter).toBeCloseTo(1, 1);
  });

  it("reports the assumption rather than banking it quietly", () => {
    const short = run(owned).teams.find((t) => t.rosterId === 2)!;
    expect(short.waiverFilledSlots).toBeCloseTo(1, 2);
    expect(short.waiverPointsShare).toBeGreaterThan(0);
    expect(short.assumedSignings[0]?.playerId).toBe("fa-te1");
  });

  it("claims nothing for the team whose own draft covers its lineup", () => {
    const complete = run(owned).teams.find((t) => t.rosterId === 1)!;
    expect(complete.waiverFilledSlots).toBe(0);
    expect(complete.waiverPointsShare).toBe(0);
    expect(complete.assumedSignings).toEqual([]);
  });

  it("stays brutal when the position really is gone", () => {
    // The superflex dynasty case: every tight end in the world is rostered, so
    // the empty slot is worth exactly nothing and the gap stays a whole slot.
    const everyoneOwned = new Set([...owned, "fa-te1", "fa-te2"]);
    const after = run(everyoneOwned);
    const gap =
      after.teams.find((t) => t.rosterId === 1)!.meanStartingPoints -
      after.teams.find((t) => t.rosterId === 2)!.meanStartingPoints;
    expect(gap).toBeCloseTo(9, 1);
  });

  it("counts the wire fill toward slots filled, so construction sees a full lineup", () => {
    const short = run(owned).teams.find((t) => t.rosterId === 2)!;
    expect(short.startersFilled).toBeCloseTo(4, 2);
  });
});
