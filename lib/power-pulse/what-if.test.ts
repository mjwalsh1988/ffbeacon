import { describe, it, expect } from "vitest";
import {
  buildSimTeams,
  simulateWithReplacements,
  type WeeklyDistribution,
  type WhatIfOutcome,
  type WhatIfRoster,
} from "./what-if";
import type { ScheduleWeek } from "./types";

const WEEKS = [10, 11];

const ROSTERS: WhatIfRoster[] = [
  { sleeperRosterId: 1, wins: 5, losses: 4, ties: 0, pointsFor: 900 },
  { sleeperRosterId: 2, wins: 5, losses: 4, ties: 0, pointsFor: 890 },
  { sleeperRosterId: 3, wins: 4, losses: 5, ties: 0, pointsFor: 880 },
  { sleeperRosterId: 4, wins: 4, losses: 5, ties: 0, pointsFor: 870 },
];

function distribution(mean: number, sigma: number): WeeklyDistribution {
  return new Map(WEEKS.map((w) => [w, { mean, sigma }]));
}

function baselineMap(): Map<number, WeeklyDistribution> {
  return new Map(ROSTERS.map((r) => [r.sleeperRosterId, distribution(100, 20)]));
}

const SCHEDULE: ScheduleWeek[] = [
  {
    week: 10,
    opponents: new Map([
      [1, 2],
      [2, 1],
      [3, 4],
      [4, 3],
    ]),
    isFinal: false,
  },
  {
    week: 11,
    opponents: new Map([
      [1, 3],
      [3, 1],
      [2, 4],
      [4, 2],
    ]),
    isFinal: false,
  },
];

const OPTIONS = { runs: 400, seed: 42, playoffTeams: 2, playoffWeekStart: 15 };

function snapshot(outcomes: Map<number, WhatIfOutcome>): [number, WhatIfOutcome][] {
  return [...outcomes.entries()].sort((a, b) => a[0] - b[0]);
}

describe("buildSimTeams", () => {
  it("carries the standings through and averages the weekly distribution", () => {
    const weekly = new Map<number, WeeklyDistribution>([
      [
        1,
        new Map([
          [10, { mean: 100, sigma: 10 }],
          [11, { mean: 140, sigma: 30 }],
        ]),
      ],
    ]);
    const [team] = buildSimTeams([ROSTERS[0]], weekly);

    expect(team.sleeperRosterId).toBe(1);
    expect(team.wins).toBe(5);
    expect(team.losses).toBe(4);
    expect(team.ties).toBe(0);
    expect(team.pointsFor).toBe(900);
    expect(team.mean).toBe(120);
    expect(team.sigma).toBe(20);
  });

  it("gives a roster with no weekly entries a zero season distribution", () => {
    const [team] = buildSimTeams([ROSTERS[0]], new Map());
    expect(team.weeks.size).toBe(0);
    expect(team.mean).toBe(0);
    expect(team.sigma).toBe(0);
  });
});

describe("simulateWithReplacements", () => {
  it("returns null when there is nothing left to play", () => {
    const result = simulateWithReplacements({
      rosters: ROSTERS,
      baseline: baselineMap(),
      replacements: new Map(),
      upcoming: [],
      options: OPTIONS,
    });
    expect(result).toBeNull();
  });

  it("overlays the replacement onto the baseline and leaves the rest alone", () => {
    const result = simulateWithReplacements({
      rosters: ROSTERS,
      baseline: baselineMap(),
      replacements: new Map([[1, distribution(200, 20)]]),
      upcoming: SCHEDULE,
      options: OPTIONS,
    });

    expect(result).not.toBeNull();
    const { before, after } = result as NonNullable<typeof result>;

    // The replaced roster scores far more, so it wins both remaining games.
    expect(after.get(1)!.expectedWins).toBeGreaterThan(before.get(1)!.expectedWins);
    expect(after.get(1)!.playoffOdds).toBeGreaterThan(before.get(1)!.playoffOdds);

    // Roster 4 never plays roster 1, so its own week scores are untouched. Its
    // odds still move, which is the point of simulating the whole league rather
    // than one team in isolation.
    expect(after.get(4)!.expectedWins).toBeLessThanOrEqual(
      before.get(4)!.expectedWins + 1e-9,
    );
  });

  it("returns identical before and after when nothing is replaced", () => {
    const result = simulateWithReplacements({
      rosters: ROSTERS,
      baseline: baselineMap(),
      replacements: new Map(),
      upcoming: SCHEDULE,
      options: OPTIONS,
    });
    expect(result).not.toBeNull();
    const { before, after } = result as NonNullable<typeof result>;
    expect(snapshot(after)).toEqual(snapshot(before));
  });

  it("does not mutate the baseline map", () => {
    const baseline = baselineMap();
    const originalForOne = baseline.get(1);
    const originalEntries = [...baseline.entries()];

    simulateWithReplacements({
      rosters: ROSTERS,
      baseline,
      replacements: new Map([[1, distribution(200, 20)]]),
      upcoming: SCHEDULE,
      options: OPTIONS,
    });

    expect(baseline.get(1)).toBe(originalForOne);
    expect([...baseline.entries()]).toEqual(originalEntries);
    expect(baseline.get(1)!.get(10)).toEqual({ mean: 100, sigma: 20 });
  });

  it("is deterministic for a given seed", () => {
    const run = () =>
      simulateWithReplacements({
        rosters: ROSTERS,
        baseline: baselineMap(),
        replacements: new Map([[2, distribution(130, 25)]]),
        upcoming: SCHEDULE,
        options: OPTIONS,
      });

    const first = run();
    const second = run();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(snapshot(second!.before)).toEqual(snapshot(first!.before));
    expect(snapshot(second!.after)).toEqual(snapshot(first!.after));
  });

  it("moves with the seed, so the fixed seed is doing real work", () => {
    const withSeed = (seed: number) =>
      simulateWithReplacements({
        rosters: ROSTERS,
        baseline: baselineMap(),
        replacements: new Map(),
        upcoming: SCHEDULE,
        options: { ...OPTIONS, seed },
      });

    const a = withSeed(1)!;
    const b = withSeed(999)!;
    expect(snapshot(b.before)).not.toEqual(snapshot(a.before));
  });
});
