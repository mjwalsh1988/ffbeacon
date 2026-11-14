/**
 * LPI-T04: empty rosters, the playoff mode, the finished season and the live
 * week, through the whole engine.
 */

import { describe, expect, it } from "vitest";
import { computePowerPulse, liveWeekLineup } from "./engine";
import { fixtureLeague, fixturePowerPulseInput } from "./test-fixtures";
import { parseBracket } from "./playoffs";
import type { PlayerRow, ProjectionRow } from "./load";
import { PULSE_SLOT_ELIGIBILITY } from "./types";

/** The fixture's weeks 5 to 14 moved to 15 to 18, so the playoff weeks have projections. */
function playoffProjections(): ProjectionRow[] {
  return fixturePowerPulseInput()
    .projections.map((p) => ({ ...p, week: p.week + 10 }))
    .filter((p) => p.week <= 18);
}

function playoffInput(winners: unknown = null) {
  return fixturePowerPulseInput({
    currentWeek: 15,
    projections: playoffProjections(),
    schedule: [],
    league: fixtureLeague({
      playoffTeams: 2,
      playoffWeekStart: 15,
      winnersBracket: parseBracket(winners),
    }),
  });
}

describe("a roster with no players", () => {
  it("is not scored, ranked or seeded", () => {
    const input = fixturePowerPulseInput();
    input.rosters[0] = { ...input.rosters[0], playerSleeperIds: [], starterSleeperIds: [] };
    const out = computePowerPulse(input);
    expect(out.map((t) => t.sleeperRosterId).sort()).toEqual([2, 3, 4]);
    expect(out.map((t) => t.pulseRank).sort()).toEqual([1, 2, 3]);
  });
});

describe("the playoff mode", () => {
  it("scores a league whose regular season is over instead of giving up on it", () => {
    const out = computePowerPulse(playoffInput());
    expect(out).toHaveLength(4);
    // Every roster is 2-2, so points for seeds the field: rosters 4 and 3.
    const byId = new Map(out.map((t) => [t.sleeperRosterId, t]));
    expect(byId.get(4)!.playoffOdds).toBe(1);
    expect(byId.get(3)!.playoffOdds).toBe(1);
    expect(byId.get(1)!.playoffOdds).toBe(0);
    expect(byId.get(1)!.titleOdds).toBe(0);
    expect((byId.get(3)!.titleOdds ?? 0) + (byId.get(4)!.titleOdds ?? 0)).toBeCloseTo(1, 3);
    expect(byId.get(4)!.components.playoff).toEqual({
      phase: "playoffs",
      seed: 1,
      status: "alive",
      finalPlace: null,
    });
    expect(byId.get(1)!.components.playoff?.status).toBe("missed");
    // The projected record is the record: no regular season game is left.
    expect(byId.get(4)!.projectedWins).toBe(2);
    expect(byId.get(4)!.projectedLosses).toBe(2);
  });

  it("reads the real champion and final order once the title game is played", () => {
    const out = computePowerPulse(
      playoffInput([{ m: 1, r: 1, p: 1, t1: 4, t2: 3, w: 3, l: 4 }]),
    );
    const byId = new Map(out.map((t) => [t.sleeperRosterId, t]));
    expect(byId.get(3)!.titleOdds).toBe(1);
    expect(byId.get(4)!.titleOdds).toBe(0);
    expect(byId.get(3)!.components.playoff).toMatchObject({ phase: "complete", status: "champion", finalPlace: 1 });
    expect(byId.get(4)!.components.playoff).toMatchObject({ status: "eliminated", finalPlace: 2 });
    expect(byId.get(2)!.components.playoff?.finalPlace).toBe(3);
  });

  it("carries no playoff state in a chopped league", () => {
    const out = computePowerPulse(fixturePowerPulseInput({ league: fixtureLeague({ chopped: true }) }));
    expect(out.every((t) => t.components.playoff === undefined)).toBe(true);
  });
});

describe("the live week", () => {
  it("counts the points a locked lineup has already scored, with no spread left", () => {
    const input = fixturePowerPulseInput({
      live: {
        week: 5,
        // Every fixture player is on BUF, so the whole lineup is locked.
        startedTeams: new Set(["BUF"]),
        rosters: new Map([
          [
            1,
            {
              starters: ["s-1-QB", "s-1-RB", "s-1-WR", "s-1-TE"],
              points: new Map([
                ["s-1-QB", 30],
                ["s-1-RB", 25],
                ["s-1-WR", 20],
                ["s-1-TE", 25],
              ]),
            },
          ],
        ]),
      },
    });
    const out = computePowerPulse(input);
    const week5 = out.find((t) => t.sleeperRosterId === 1)!.weekly.find((w) => w.week === 5)!;
    expect(week5.mean).toBe(100);
    expect(week5.sigma).toBe(0);
    // A roster with no live row is projected as before.
    const before = computePowerPulse(fixturePowerPulseInput());
    const other = (rows: typeof out) =>
      rows.find((t) => t.sleeperRosterId === 2)!.weekly.find((w) => w.week === 5)!.mean;
    expect(other(out)).toBe(other(before));
  });

  it("projects only the open slots, from players whose game is still to come", () => {
    const player = (sleeperId: string, position: PlayerRow["position"], team: string): PlayerRow => ({
      playerId: `p-${sleeperId}`,
      sleeperId,
      name: sleeperId,
      position,
      team,
      injuryStatus: null,
      depthOrder: 1,
    });
    const players = new Map<string, PlayerRow>([
      ["qb", player("qb", "QB", "KC")],
      ["rb1", player("rb1", "RB", "BUF")],
      ["rb2", player("rb2", "RB", "BUF")],
      ["rb3", player("rb3", "RB", "KC")],
    ]);
    const result = liveWeekLineup({
      live: {
        week: 9,
        startedTeams: new Set(["KC"]),
        rosters: new Map([[1, { starters: ["qb", "rb1"], points: new Map([["qb", 22]]) }]]),
      },
      week: 9,
      rosterId: 1,
      rosterPositions: ["QB", "RB", "BN", "BN"],
      slotMap: PULSE_SLOT_ELIGIBILITY,
      players,
      candidates: [
        { playerId: "p-qb", position: "QB", points: 18, sigma: 6 },
        { playerId: "p-rb1", position: "RB", points: 10, sigma: 4 },
        { playerId: "p-rb2", position: "RB", points: 14, sigma: 3 },
        // Benched, and his game has started: he cannot be moved in.
        { playerId: "p-rb3", position: "RB", points: 30, sigma: 5 },
      ],
      realism: 1,
    });
    // The QB's 22 scored, plus the best unplayed RB (rb2, 14) in the open slot.
    expect(result).toEqual({ mean: 36, sigma: 3 });
  });

  it("does nothing for another week or a roster with no live row", () => {
    const base = {
      week: 9,
      rosterId: 1,
      rosterPositions: ["QB"],
      slotMap: PULSE_SLOT_ELIGIBILITY,
      players: new Map<string, PlayerRow>(),
      candidates: [],
      realism: 1,
    };
    const live = { week: 8, startedTeams: new Set(["KC"]), rosters: new Map() };
    expect(liveWeekLineup({ ...base, live })).toBeNull();
    expect(liveWeekLineup({ ...base, live: { ...live, week: 9 } })).toBeNull();
    expect(liveWeekLineup({ ...base, live: null })).toBeNull();
  });
});
