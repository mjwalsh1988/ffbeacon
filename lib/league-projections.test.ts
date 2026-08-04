import { describe, expect, it } from "vitest";
import {
  compareProjectedLeagues,
  finishPercentile,
  summarizeProjections,
  type ProjectedLeague,
  type ProjectionInput,
} from "./league-projections";

// Spread, not `??`: an explicit null is the case under test here, and `?? 1`
// would quietly turn "this league has no projection" back into a first-place
// finish.
function input(over: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    sleeperLeagueId: "1",
    leagueName: "League",
    projectedSeed: 1,
    rankedTeamCount: 12,
    statusLabel: null,
    ...over,
  };
}

function ranked(over: Partial<ProjectedLeague> = {}): ProjectedLeague {
  return {
    sleeperLeagueId: "1",
    leagueName: "League",
    projectedSeed: 1,
    rankedTeamCount: 12,
    statusLabel: null,
    percentile: 0,
    ...over,
  };
}

describe("finishPercentile", () => {
  it("puts first at 0 and last at 1", () => {
    expect(finishPercentile(1, 12)).toBe(0);
    expect(finishPercentile(12, 12)).toBe(1);
  });

  it("normalises across league sizes", () => {
    // Middle of an 11-team league and middle of a 21-team league agree.
    expect(finishPercentile(6, 11)).toBeCloseTo(0.5);
    expect(finishPercentile(11, 21)).toBeCloseTo(0.5);
  });

  it("treats a one-team league as a win rather than dividing by zero", () => {
    expect(finishPercentile(1, 1)).toBe(0);
    expect(Number.isFinite(finishPercentile(1, 1))).toBe(true);
  });
});

describe("compareProjectedLeagues", () => {
  it("orders by raw seed first", () => {
    const a = ranked({ projectedSeed: 2 });
    const b = ranked({ projectedSeed: 1 });
    expect([a, b].sort(compareProjectedLeagues)[0]).toBe(b);
  });

  it("breaks a tie toward the bigger league", () => {
    const small = ranked({
      projectedSeed: 1,
      rankedTeamCount: 8,
      leagueName: "A",
    });
    const big = ranked({
      projectedSeed: 1,
      rankedTeamCount: 14,
      leagueName: "Z",
    });
    expect([small, big].sort(compareProjectedLeagues)[0]).toBe(big);
  });

  it("falls back to the name so the order is stable", () => {
    const zeta = ranked({ leagueName: "Zeta" });
    const alpha = ranked({ leagueName: "Alpha" });
    expect([zeta, alpha].sort(compareProjectedLeagues)[0]).toBe(alpha);
  });
});

describe("summarizeProjections", () => {
  it("counts unranked leagues instead of guessing a finish", () => {
    const out = summarizeProjections([
      input({ projectedSeed: 1 }),
      input({
        sleeperLeagueId: "2",
        projectedSeed: null,
        rankedTeamCount: null,
      }),
    ]);
    expect(out.leagues).toHaveLength(1);
    expect(out.unrankedCount).toBe(1);
  });

  it("counts podium finishes and the bottom third", () => {
    const out = summarizeProjections([
      input({ sleeperLeagueId: "1", projectedSeed: 1, rankedTeamCount: 12 }),
      input({ sleeperLeagueId: "2", projectedSeed: 2, rankedTeamCount: 12 }),
      input({ sleeperLeagueId: "3", projectedSeed: 3, rankedTeamCount: 12 }),
      input({ sleeperLeagueId: "4", projectedSeed: 12, rankedTeamCount: 12 }),
    ]);
    expect(out.first).toBe(1);
    expect(out.second).toBe(1);
    expect(out.third).toBe(1);
    expect(out.topThird).toBe(3);
    expect(out.bottomThird).toBe(1);
    expect(out.lastPlace).toBe(1);
  });

  it("does not call a one-team league a last-place finish", () => {
    const out = summarizeProjections([
      input({ projectedSeed: 1, rankedTeamCount: 1 }),
    ]);
    expect(out.lastPlace).toBe(0);
  });

  it("says nothing at all when nothing is ranked", () => {
    const out = summarizeProjections([
      input({ projectedSeed: null, rankedTeamCount: null }),
    ]);
    expect(out.anecdote).toBe("");
    expect(out.leagues).toHaveLength(0);
  });

  it("picks the winning line over the podium line when both apply", () => {
    // Four firsts also clears the podium threshold; the more specific line wins.
    const out = summarizeProjections(
      [1, 1, 1, 1].map((seed, i) =>
        input({ sleeperLeagueId: String(i), projectedSeed: seed }),
      ),
    );
    expect(out.anecdote).toContain("Projected first in half your leagues");
  });

  it("has a line for a manager whose teams are nearly all near the bottom", () => {
    const out = summarizeProjections(
      [11, 12, 10, 12].map((seed, i) =>
        input({ sleeperLeagueId: String(i), projectedSeed: seed }),
      ),
    );
    expect(out.bottomThird).toBe(4);
    expect(out.anecdote).not.toBe("");
  });

  it("calls out an all-mid-table set", () => {
    const out = summarizeProjections(
      [6, 7, 6, 7].map((seed, i) =>
        input({ sleeperLeagueId: String(i), projectedSeed: seed }),
      ),
    );
    expect(out.topThird).toBe(0);
    expect(out.bottomThird).toBe(0);
    expect(out.anecdote).toContain("mid-table");
  });

  it("always produces some line when at least one league is ranked", () => {
    const shapes: number[][] = [
      [1],
      [12],
      [6],
      [1, 6, 12],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      [4, 5, 9],
    ];
    for (const seeds of shapes) {
      const out = summarizeProjections(
        seeds.map((seed, i) =>
          input({ sleeperLeagueId: String(i), projectedSeed: seed }),
        ),
      );
      expect(out.anecdote.length).toBeGreaterThan(0);
    }
  });
});
