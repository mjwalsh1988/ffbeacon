import { describe, it, expect } from "vitest";
import { simulateSeason, type SimTeam } from "./simulate";
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
