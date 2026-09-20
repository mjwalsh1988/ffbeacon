import { describe, it, expect } from "vitest";
import { simulateSurvival, type SurvivalTeam } from "./survival";

function team(
  rosterId: number,
  weeks: number[],
  mean: number,
  sigma: number,
  seasonPoints = 0,
): SurvivalTeam {
  const map = new Map<number, { mean: number; sigma: number }>();
  for (const w of weeks) map.set(w, { mean, sigma });
  return { rosterId, seasonPoints, weeks: map };
}

/** Flatten a result map so two runs can be compared exactly. */
function snapshot(results: ReturnType<typeof simulateSurvival>): string {
  return JSON.stringify(
    [...results.values()]
      .sort((a, b) => a.rosterId - b.rosterId)
      .map((r) => ({
        rosterId: r.rosterId,
        pChoppedThisWeek: r.pChoppedThisWeek,
        pWin: r.pWin,
        expectedWeeksAlive: r.expectedWeeksAlive,
        pAliveAfter: [...r.pAliveAfter.entries()],
      })),
  );
}

const WEEKS = [1, 2, 3, 4];

describe("simulateSurvival", () => {
  it("is deterministic for a seed", () => {
    const build = () => [
      team(1, WEEKS, 110, 20),
      team(2, WEEKS, 100, 25),
      team(3, WEEKS, 95, 18),
      team(4, WEEKS, 90, 30),
    ];
    const a = simulateSurvival(build(), WEEKS, { runs: 500, seed: 42 });
    const b = simulateSurvival(build(), WEEKS, { runs: 500, seed: 42 });
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it("gives a different answer for a different seed, so the seed is doing work", () => {
    const build = () => [
      team(1, WEEKS, 110, 20),
      team(2, WEEKS, 100, 25),
      team(3, WEEKS, 95, 18),
      team(4, WEEKS, 90, 30),
    ];
    const a = simulateSurvival(build(), WEEKS, { runs: 500, seed: 42 });
    const b = simulateSurvival(build(), WEEKS, { runs: 500, seed: 43 });
    expect(snapshot(a)).not.toBe(snapshot(b));
  });

  it("chops each of five identical teams about a fifth of the time", () => {
    const teams = [1, 2, 3, 4, 5].map((id) => team(id, WEEKS, 100, 20));
    const results = simulateSurvival(teams, WEEKS, { runs: 4000, seed: 7 });
    for (const result of results.values()) {
      expect(result.pChoppedThisWeek).toBeGreaterThan(0.17);
      expect(result.pChoppedThisWeek).toBeLessThan(0.23);
      expect(result.pWin).toBeGreaterThan(0.16);
      expect(result.pWin).toBeLessThan(0.24);
    }
  });

  it("rarely chops a much stronger team and usually chops a much weaker one", () => {
    const teams = [
      team(1, WEEKS, 170, 12),
      team(2, WEEKS, 105, 12),
      team(3, WEEKS, 103, 12),
      team(4, WEEKS, 100, 12),
      team(5, WEEKS, 45, 12),
    ];
    const results = simulateSurvival(teams, WEEKS, { runs: 3000, seed: 11 });
    expect(results.get(1)?.pChoppedThisWeek).toBeLessThan(0.01);
    expect(results.get(1)?.pWin).toBeGreaterThan(0.9);
    expect(results.get(5)?.pChoppedThisWeek).toBeGreaterThan(0.95);
    expect(results.get(5)?.pWin).toBeLessThan(0.01);
  });

  it("breaks a tied score by the lower season points", () => {
    // Zero variance means both teams draw exactly their mean, so the only
    // thing separating them is what they have already banked.
    const teams = [
      {
        rosterId: 1,
        seasonPoints: 900,
        weeks: new Map([[1, { mean: 100, sigma: 0 }]]),
      },
      {
        rosterId: 2,
        seasonPoints: 400,
        weeks: new Map([[1, { mean: 100, sigma: 0 }]]),
      },
    ];
    const results = simulateSurvival(teams, [1], { runs: 50, seed: 3 });
    expect(results.get(1)?.pChoppedThisWeek).toBe(0);
    expect(results.get(2)?.pChoppedThisWeek).toBe(1);
    expect(results.get(1)?.pWin).toBe(1);
  });

  it("keeps every probability between 0 and 1 and shares one title", () => {
    const teams = [1, 2, 3, 4, 5, 6].map((id) =>
      team(id, WEEKS, 90 + id * 4, 15, id * 10),
    );
    const results = simulateSurvival(teams, WEEKS, { runs: 1500, seed: 19 });
    let totalWin = 0;
    for (const result of results.values()) {
      expect(result.pChoppedThisWeek).toBeGreaterThanOrEqual(0);
      expect(result.pChoppedThisWeek).toBeLessThanOrEqual(1);
      expect(result.pWin).toBeGreaterThanOrEqual(0);
      expect(result.pWin).toBeLessThanOrEqual(1);
      for (const p of result.pAliveAfter.values()) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      totalWin += result.pWin;
    }
    expect(totalWin).toBeCloseTo(1, 6);
  });

  it("chops exactly one team a week, so the field thins by one", () => {
    const teams = [1, 2, 3, 4, 5].map((id) => team(id, WEEKS, 100, 20));
    const results = simulateSurvival(teams, WEEKS, { runs: 400, seed: 5 });
    for (const week of WEEKS) {
      let aliveAfter = 0;
      for (const result of results.values())
        aliveAfter += result.pAliveAfter.get(week) ?? 0;
      // Five teams, one chop a week, floored at a single survivor.
      expect(aliveAfter).toBeCloseTo(Math.max(1, 5 - week), 6);
    }
  });

  it("honours choppedPerWeek when a preset chops more than one", () => {
    const teams = [1, 2, 3, 4, 5].map((id) => team(id, [1], 100, 20));
    const results = simulateSurvival(teams, [1], {
      runs: 400,
      seed: 8,
      choppedPerWeek: 2,
    });
    let chopped = 0;
    for (const result of results.values()) chopped += result.pChoppedThisWeek;
    expect(chopped).toBeCloseTo(2, 6);
  });

  it("bounds expected weeks alive by the number of weeks simulated", () => {
    const teams = [
      team(1, WEEKS, 150, 10),
      team(2, WEEKS, 100, 10),
      team(3, WEEKS, 60, 10),
    ];
    const results = simulateSurvival(teams, WEEKS, { runs: 800, seed: 23 });
    for (const result of results.values()) {
      expect(result.expectedWeeksAlive).toBeGreaterThanOrEqual(0);
      expect(result.expectedWeeksAlive).toBeLessThanOrEqual(WEEKS.length);
    }
    const strong = results.get(1)?.expectedWeeksAlive ?? 0;
    const weak = results.get(3)?.expectedWeeksAlive ?? 0;
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeCloseTo(WEEKS.length, 6);
  });

  it("makes a single remaining team the winner without drawing a score", () => {
    const results = simulateSurvival([team(7, WEEKS, 100, 20)], WEEKS, {
      runs: 50,
      seed: 2,
    });
    const only = results.get(7);
    expect(only?.pChoppedThisWeek).toBe(0);
    expect(only?.pWin).toBe(1);
    expect(only?.expectedWeeksAlive).toBe(WEEKS.length);
  });

  it("does not throw on an empty team list", () => {
    expect(() =>
      simulateSurvival([], [1, 2], { runs: 100, seed: 1 }),
    ).not.toThrow();
    expect(simulateSurvival([], [1, 2], { runs: 100, seed: 1 }).size).toBe(0);
  });

  it("returns a result for an empty week list rather than nothing", () => {
    const teams = [team(1, [], 100, 10, 500), team(2, [], 100, 10, 400)];
    const results = simulateSurvival(teams, [], { runs: 10, seed: 1 });
    expect(results.size).toBe(2);
    expect(results.get(1)?.pChoppedThisWeek).toBe(0);
    expect(results.get(1)?.expectedWeeksAlive).toBe(0);
    // Nothing left to play, so the points already banked settle it.
    expect(results.get(1)?.pWin).toBe(1);
  });

  it("plays a team through a week it has no projection for, at its own average", () => {
    const gapped: SurvivalTeam = {
      rosterId: 2,
      seasonPoints: 0,
      weeks: new Map([
        [1, { mean: 140, sigma: 5 }],
        [3, { mean: 140, sigma: 5 }],
      ]),
    };
    const teams = [
      team(1, [1, 2, 3], 170, 5),
      gapped,
      team(3, [1, 2, 3], 80, 5),
      team(4, [1, 2, 3], 70, 5),
    ];
    const results = simulateSurvival(teams, [1, 2, 3], { runs: 600, seed: 31 });
    // Week 2 is the missing one. Treating it as zero points would chop the
    // gapped team there instead of the 80 point team, which is the whole bug
    // the fallback exists to prevent.
    expect(results.get(2)?.pAliveAfter.get(2)).toBe(1);
    expect(results.get(3)?.pAliveAfter.get(2)).toBe(0);
    expect(results.get(2)?.pChoppedThisWeek).toBe(0);
  });
});
