import { describe, it, expect } from "vitest";
import {
  pairKey,
  playoffWeekCount,
  SEED_FIXED,
  seedIndices,
  simulateSeason,
  standardSeedOrder,
  weekMedian,
  type SimTeam,
} from "./simulate";
import type { ScheduleWeek } from "./types";

/** Build a round-robin-ish schedule pairing roster 1v2, 3v4, and so on. */
function pairedWeek(
  week: number,
  rosterIds: number[],
  offset: number,
): ScheduleWeek {
  const opponents = new Map<number, number>();
  const rotated = [
    rosterIds[0],
    ...rosterIds.slice(1 + offset),
    ...rosterIds.slice(1, 1 + offset),
  ];
  for (let i = 0; i < rotated.length; i += 2) {
    const a = rotated[i];
    const b = rotated[i + 1];
    if (b === undefined) continue;
    opponents.set(a, b);
    opponents.set(b, a);
  }
  return { week, opponents, isFinal: false };
}

function team(id: number, mean: number, sigma = 20): SimTeam {
  const weeks = new Map<number, { mean: number; sigma: number }>();
  for (let w = 1; w <= 14; w += 1) weeks.set(w, { mean, sigma });
  return {
    sleeperRosterId: id,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    weeks,
    mean,
    sigma,
  };
}

const OPTIONS = { runs: 1500, seed: 42, playoffTeams: 6, playoffWeekStart: 15 };

describe("simulateSeason", () => {
  const rosterIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const schedule = Array.from({ length: 14 }, (_, i) =>
    pairedWeek(i + 1, rosterIds, i % 11),
  );

  it("gives a clearly better team better odds than a clearly worse one", () => {
    const teams = rosterIds.map((id) =>
      team(id, id === 1 ? 145 : id === 12 ? 90 : 115),
    );
    const results = simulateSeason(teams, schedule, OPTIONS);
    const best = results.get(1)!;
    const worst = results.get(12)!;
    expect(best.expectedWins).toBeGreaterThan(worst.expectedWins);
    expect(best.playoffOdds).toBeGreaterThan(worst.playoffOdds);
    expect(best.titleOdds).toBeGreaterThan(worst.titleOdds);
    expect(worst.lastPlaceOdds).toBeGreaterThan(best.lastPlaceOdds);
  });

  it("produces probabilities that stay inside 0 and 1 and sum sensibly", () => {
    const teams = rosterIds.map((id) => team(id, 100 + id));
    const results = simulateSeason(teams, schedule, OPTIONS);

    let playoffSum = 0;
    let titleSum = 0;
    let lastSum = 0;
    for (const r of results.values()) {
      for (const v of [
        r.playoffOdds,
        r.byeOdds,
        r.titleOdds,
        r.lastPlaceOdds,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      playoffSum += r.playoffOdds;
      titleSum += r.titleOdds;
      lastSum += r.lastPlaceOdds;
    }
    // Exactly six teams make the playoffs and exactly one wins it, every run.
    expect(playoffSum).toBeCloseTo(6, 5);
    expect(titleSum).toBeCloseTo(1, 5);
    expect(lastSum).toBeCloseTo(1, 5);
  });

  it("hands out exactly the right number of first-round byes", () => {
    const teams = rosterIds.map((id) => team(id, 100 + id));
    const results = simulateSeason(teams, schedule, OPTIONS);
    let byeSum = 0;
    for (const r of results.values()) byeSum += r.byeOdds;
    // A six-team field in an eight-slot bracket means two byes.
    expect(byeSum).toBeCloseTo(2, 5);
  });

  it("is deterministic for a given seed", () => {
    const teams = rosterIds.map((id) => team(id, 100 + id));
    const a = simulateSeason(teams, schedule, OPTIONS);
    const b = simulateSeason(teams, schedule, OPTIONS);
    for (const id of rosterIds) {
      expect(a.get(id)!.titleOdds).toBe(b.get(id)!.titleOdds);
      expect(a.get(id)!.playoffOdds).toBe(b.get(id)!.playoffOdds);
    }
  });

  it("counts wins already banked when no weeks remain", () => {
    const teams = rosterIds.map((id) => {
      const t = team(id, 110);
      t.wins = id === 1 ? 10 : 4;
      return t;
    });
    const results = simulateSeason(teams, [], OPTIONS);
    expect(results.get(1)!.expectedWins).toBeCloseTo(10, 5);
    expect(results.get(1)!.playoffOdds).toBeCloseTo(1, 5);
  });

  it("handles a four-team playoff with no byes", () => {
    const teams = rosterIds.map((id) => team(id, 100 + id));
    const results = simulateSeason(teams, schedule, {
      ...OPTIONS,
      playoffTeams: 4,
    });
    let byeSum = 0;
    let playoffSum = 0;
    for (const r of results.values()) {
      byeSum += r.byeOdds;
      playoffSum += r.playoffOdds;
    }
    expect(byeSum).toBeCloseTo(0, 5);
    expect(playoffSum).toBeCloseTo(4, 5);
  });

  it("terminates on an odd playoff field", () => {
    const teams = rosterIds.map((id) => team(id, 100 + id));
    const results = simulateSeason(teams, schedule, {
      ...OPTIONS,
      playoffTeams: 5,
    });
    let titleSum = 0;
    for (const r of results.values()) titleSum += r.titleOdds;
    expect(titleSum).toBeCloseTo(1, 5);
  });

  it("returns an empty map for a league with no teams", () => {
    expect(simulateSeason([], schedule, OPTIONS).size).toBe(0);
  });
});

describe("playoff round type", () => {
  /**
   * Two clearly unequal teams in a two-team bracket, so the only thing the
   * simulation is deciding is the championship itself.
   */
  const strong = { mean: 130, sigma: 30 };
  const weak = { mean: 110, sigma: 30 };

  const bracket = (playoffRoundType: number) =>
    simulateSeason(
      [
        {
          sleeperRosterId: 1,
          wins: 10,
          losses: 0,
          ties: 0,
          pointsFor: 1300,
          weeks: new Map(),
          ...strong,
        },
        {
          sleeperRosterId: 2,
          wins: 0,
          losses: 10,
          ties: 0,
          pointsFor: 1100,
          weeks: new Map(),
          ...weak,
        },
      ],
      [],
      {
        runs: 8000,
        seed: 7,
        playoffTeams: 2,
        playoffWeekStart: 15,
        playoffRoundType,
      },
    );

  it("gives the better team a real edge over two weeks that one week does not", () => {
    // Summing two draws doubles the mean gap while the spread grows only by
    // sqrt(2), so the noise shrinks relative to the difference in quality.
    const oneWeek = bracket(0).get(1)!.titleOdds;
    const twoWeek = bracket(1).get(1)!.titleOdds;
    expect(twoWeek).toBeGreaterThan(oneWeek + 0.02);
  });

  it("treats round type 2 as a two-week championship", () => {
    // With a two-team field the only round IS the championship, so type 2 must
    // match type 1 here.
    expect(bracket(2).get(1)!.titleOdds).toBeCloseTo(
      bracket(1).get(1)!.titleOdds,
      2,
    );
  });

  it("leaves an unset round type simulating exactly as it did before", () => {
    const explicit = bracket(0).get(1)!.titleOdds;
    const absent = simulateSeason(
      [
        {
          sleeperRosterId: 1,
          wins: 10,
          losses: 0,
          ties: 0,
          pointsFor: 1300,
          weeks: new Map(),
          ...strong,
        },
        {
          sleeperRosterId: 2,
          wins: 0,
          losses: 10,
          ties: 0,
          pointsFor: 1100,
          weeks: new Map(),
          ...weak,
        },
      ],
      [],
      { runs: 8000, seed: 7, playoffTeams: 2, playoffWeekStart: 15 },
    ).get(1)!.titleOdds;
    expect(absent).toBe(explicit);
  });

  it("still hands out exactly one title across the field", () => {
    for (const type of [0, 1, 2]) {
      const results = bracket(type);
      const total = [...results.values()].reduce(
        (sum, r) => sum + r.titleOdds,
        0,
      );
      expect(total, `round type ${type}`).toBeCloseTo(1, 2);
    }
  });
});

/**
 * Sleeper's league_average_match: every team also plays the league median each
 * week and picks up a second result for it. The roster record counts those,
 * so the simulation must add two results a week in such a league, or the
 * projected record is seeded from a two-a-week record and grows one a week.
 */
describe("simulateSeason with a weekly median game", () => {
  const rosterIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const schedule = Array.from({ length: 14 }, (_, i) => pairedWeek(i + 1, rosterIds, i % 11));
  const sumWins = (results: Map<number, { expectedWins: number }>) =>
    [...results.values()].reduce((sum, r) => sum + r.expectedWins, 0);

  it("hands out one extra result per team per week, half of them wins", () => {
    const teams = rosterIds.map((id) => team(id, 115));
    const without = simulateSeason(teams, schedule, OPTIONS);
    const withMedian = simulateSeason(teams, schedule, { ...OPTIONS, medianMatch: true });
    // Twelve teams, fourteen weeks: six head-to-head wins a week without the
    // median game, twelve with it (six above the median, six below).
    expect(sumWins(without)).toBeCloseTo(6 * 14, 5);
    expect(sumWins(withMedian)).toBeCloseTo(12 * 14, 5);
  });

  it("favors a high scorer twice over: the median game rewards points, not the draw", () => {
    const teams = rosterIds.map((id) => team(id, id === 1 ? 145 : 115));
    const without = simulateSeason(teams, schedule, OPTIONS).get(1)!;
    const withMedian = simulateSeason(teams, schedule, { ...OPTIONS, medianMatch: true }).get(1)!;
    expect(withMedian.expectedWins).toBeGreaterThan(without.expectedWins + 7);
  });

  it("is off unless asked for, so an existing league's odds do not move", () => {
    const teams = rosterIds.map((id) => team(id, 115));
    const a = simulateSeason(teams, schedule, OPTIONS);
    const b = simulateSeason(teams, schedule, { ...OPTIONS, medianMatch: false });
    expect(a.get(1)!.expectedWins).toBe(b.get(1)!.expectedWins);
  });
});

describe("weekMedian", () => {
  it("takes the middle score of an odd count and the average of the two middle of an even one", () => {
    expect(weekMedian([3, 1, 2])).toBe(2);
    expect(weekMedian([4, 1, 3, 2])).toBe(2.5);
  });

  it("is zero for no scores rather than NaN", () => {
    expect(weekMedian([])).toBe(0);
  });
});

describe("bracket shape and seeding (LPI-T04)", () => {
  it("lays seeds out in the standard bracket order", () => {
    expect(standardSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(standardSeedOrder(4)).toEqual([1, 4, 2, 3]);
  });

  it("counts the playoff weeks each round type runs", () => {
    expect(playoffWeekCount(6, 0)).toBe(3);
    expect(playoffWeekCount(6, 1)).toBe(6);
    expect(playoffWeekCount(6, 2)).toBe(4);
    expect(playoffWeekCount(4, 0)).toBe(2);
    expect(playoffWeekCount(1, 0)).toBe(0);
  });

  it("lifts each division's best record to the top seeds, then seeds the rest by record", () => {
    const wins = [10, 9, 8, 3];
    const points = [0, 0, 0, 0];
    expect(seedIndices(4, wins, points, null, 2)).toEqual([0, 1, 2, 3]);
    expect(seedIndices(4, wins, points, [1, 1, 1, 2], 2)).toEqual([0, 3, 1, 2]);
  });

  it("seeds division winners into the field even over a better wildcard record", () => {
    // Four teams, two playoff spots, two divisions. Roster 4 wins division 2
    // with the worst record and must take a spot from roster 2.
    const teams = [1, 2, 3, 4].map((id) => ({
      ...team(id, 100),
      wins: [10, 9, 8, 3][id - 1],
      losses: 13 - [10, 9, 8, 3][id - 1],
      division: id === 4 ? 2 : 1,
    }));
    const results = simulateSeason(teams, [], { ...OPTIONS, playoffTeams: 2, divisions: 2 });
    expect(results.get(4)!.playoffOdds).toBe(1);
    expect(results.get(2)!.playoffOdds).toBe(0);
  });

  it("never redraws a playoff game the bracket has already settled", () => {
    // Regular season over, four team field. The bracket says the weakest team
    // beat the strongest in the semifinal, so the strongest cannot win it all.
    const teams = [1, 2, 3, 4].map((id) => ({
      ...team(id, id === 1 ? 200 : 100, 5),
      wins: 14 - id,
      losses: id,
    }));
    const results = simulateSeason(teams, [], {
      ...OPTIONS,
      playoffTeams: 4,
      playoffSeedType: SEED_FIXED,
      playedPlayoffGames: new Map([[pairKey(1, 4), 4]]),
      eliminatedFromTitle: new Set([1]),
    });
    expect(results.get(1)!.titleOdds).toBe(0);
    expect(results.get(4)!.titleOdds).toBeGreaterThan(0);
  });

  it("keeps a fixed bracket fixed: seed 1 meets the 4 v 5 winner whoever wins", () => {
    // Six team fixed bracket, seed 3 far stronger than everyone. Under a fixed
    // bracket it can meet seed 1 only in the final; reseeded, seed 1 meets the
    // lowest seed left. The title odds of seed 2 tell the two apart: fixed,
    // seed 2 always has to go through seed 3 (3 v 6 winner) in the semifinal.
    const strength = [110, 110, 300, 100, 100, 100];
    const teams = [1, 2, 3, 4, 5, 6].map((id) => ({
      ...team(id, strength[id - 1], 5),
      wins: 20 - id,
      losses: id,
    }));
    const fixed = simulateSeason(teams, [], { ...OPTIONS, playoffSeedType: SEED_FIXED });
    expect(fixed.get(3)!.titleOdds).toBeGreaterThan(0.99);
    expect(fixed.get(2)!.titleOdds).toBe(0);
  });

  it("plays each playoff round on that week's own projection", () => {
    // Two teams, equal all season, but roster 2 is far better in week 15.
    const teams = [1, 2].map((id) => {
      const t = team(id, 100, 5);
      t.wins = id === 1 ? 10 : 9;
      t.weeks.set(15, { mean: id === 2 ? 200 : 100, sigma: 5 });
      return t;
    });
    const results = simulateSeason(teams, [], { ...OPTIONS, playoffTeams: 2 });
    expect(results.get(2)!.titleOdds).toBeGreaterThan(0.99);
  });
});
