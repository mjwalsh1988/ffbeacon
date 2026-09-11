import { describe, expect, it } from "vitest";
import { computeStartSit, type StartSitEngineInput } from "./engine";
import { winProbability } from "@/lib/power-pulse/math";
import type { StartSitCandidate, StartSitProjection } from "./types";

/* -------------------------------------------------------------------------- */
/* Fixture builders, matching the pattern already established by             */
/* rank.test.ts and reasons.test.ts in this directory.                       */
/* -------------------------------------------------------------------------- */

function candidate(overrides: Partial<StartSitCandidate> & { playerId: string; name: string }): StartSitCandidate {
  return {
    playerId: overrides.playerId,
    slug: overrides.slug ?? overrides.playerId,
    sleeperId: overrides.sleeperId ?? null,
    name: overrides.name,
    position: overrides.position ?? "RB",
    team: overrides.team ?? "ATL",
    injuryStatus: overrides.injuryStatus ?? null,
  };
}

function projection(playerId: string, overrides: Partial<StartSitProjection> = {}): StartSitProjection {
  return {
    playerId,
    week: 3,
    points: null,
    rawPoints: null,
    sigma: null,
    floor: null,
    ceiling: null,
    opponent: null,
    opponentMultiplier: null,
    defenseRankVsPosition: null,
    beatRate: null,
    availabilityRate: null,
    weeksGraded: 0,
    environment: null,
    environmentTier: null,
    onBye: false,
    availability: "projected",
    ...overrides,
  };
}

function baseInput(
  candidates: StartSitCandidate[],
  projections: Record<string, StartSitProjection>,
  overrides: Partial<StartSitEngineInput> = {},
): StartSitEngineInput {
  return {
    candidates,
    projections,
    startCount: 1,
    week: 3,
    season: 2026,
    formatDisplay: "PPR",
    projectionSource: "sleeper",
    ...overrides,
  };
}

const BANNED_CHARACTERS = [
  "—", // em dash
  "–", // en dash
  "“", // left curly double quote
  "”", // right curly double quote
  "‘", // left curly single quote
  "’", // right curly single quote
  "…", // ellipsis character
];

function assertNoBannedCharacters(sentences: string[]): void {
  for (const sentence of sentences) {
    for (const char of BANNED_CHARACTERS) {
      expect(sentence.includes(char), `found banned character in "${sentence}"`).toBe(false);
    }
  }
}

/* -------------------------------------------------------------------------- */

describe("computeStartSit", () => {
  it("N of 2, K of 1: starts the higher projection and measures margin and confidence on the only pair", () => {
    const a = candidate({ playerId: "a", name: "Bijan Robinson" });
    const b = candidate({ playerId: "b", name: "Josh Jacobs" });
    const projections = {
      a: projection("a", { points: 20.4, sigma: 6 }),
      b: projection("b", { points: 18, sigma: 5 }),
    };

    const verdict = computeStartSit(baseInput([a, b], projections, { startCount: 1 }));

    expect(verdict.starters).toEqual(["a"]);
    expect(verdict.bench).toEqual(["b"]);
    expect(verdict.startCount).toBe(1);
    expect(verdict.marginPoints).not.toBeNull();
    expect(verdict.marginPoints!).toBeCloseTo(2.4, 5);
    expect(verdict.confidence).not.toBeNull();
    expect(verdict.confidence!).toBeCloseTo(winProbability(20.4, 6, 18, 5), 10);
    expect(verdict.callLabel).not.toBe("unmeasured");
    expect(verdict.verdictLine.length).toBeGreaterThan(0);
    expect(verdict.verdictLine).toContain("Bijan Robinson");
    expect(verdict.reasons.length).toBeGreaterThan(0);
    assertNoBannedCharacters([verdict.verdictLine, ...verdict.reasons]);
  });

  it("N of 3, K of 1: margin and confidence are measured on the last starter and the first benched player", () => {
    const a = candidate({ playerId: "a", name: "Amon-Ra St. Brown" });
    const b = candidate({ playerId: "b", name: "Chris Olave" });
    const c = candidate({ playerId: "c", name: "Rome Odunze" });
    const projections = {
      a: projection("a", { points: 22, sigma: 6.5 }),
      b: projection("b", { points: 15, sigma: 5.5 }),
      c: projection("c", { points: 11, sigma: 5 }),
    };

    const verdict = computeStartSit(baseInput([a, b, c], projections, { startCount: 1 }));

    expect(verdict.starters).toEqual(["a"]);
    expect(verdict.bench).toEqual(["b", "c"]);
    expect(verdict.marginPoints!).toBeCloseTo(22 - 15, 5);
    expect(verdict.confidence!).toBeCloseTo(winProbability(22, 6.5, 15, 5.5), 10);
  });

  it("N of 3, K of 2: the boundary pair is starters[last] and bench[0], not the top starter", () => {
    const a = candidate({ playerId: "a", name: "Bijan Robinson" });
    const b = candidate({ playerId: "b", name: "Josh Jacobs" });
    const c = candidate({ playerId: "c", name: "Alvin Kamara" });
    const projections = {
      a: projection("a", { points: 22, sigma: 6 }),
      b: projection("b", { points: 15, sigma: 5.5 }),
      c: projection("c", { points: 14, sigma: 5 }),
    };

    const verdict = computeStartSit(baseInput([a, b, c], projections, { startCount: 2 }));

    expect(verdict.starters).toEqual(["a", "b"]);
    expect(verdict.bench).toEqual(["c"]);
    // The pair is b (last starter) vs c (first bench), not a vs c.
    expect(verdict.marginPoints!).toBeCloseTo(15 - 14, 5);
    expect(verdict.confidence!).toBeCloseTo(winProbability(15, 5.5, 14, 5), 10);
  });

  it("N of 8, K of 3: ranks correctly and measures the boundary pair among eight candidates", () => {
    const names = [
      "Player One",
      "Player Two",
      "Player Three",
      "Player Four",
      "Player Five",
      "Player Six",
      "Player Seven",
      "Player Eight",
    ];
    const points = [28, 24, 19, 17, 16, 14, 10, 5];
    const candidates = names.map((name, i) => candidate({ playerId: `p${i}`, name }));
    const projections: Record<string, StartSitProjection> = {};
    names.forEach((_, i) => {
      projections[`p${i}`] = projection(`p${i}`, { points: points[i], sigma: 5 });
    });

    const verdict = computeStartSit(baseInput(candidates, projections, { startCount: 3 }));

    expect(verdict.starters).toEqual(["p0", "p1", "p2"]);
    expect(verdict.bench).toEqual(["p3", "p4", "p5", "p6", "p7"]);
    expect(verdict.marginPoints!).toBeCloseTo(points[2] - points[3], 5);
    expect(verdict.confidence!).toBeCloseTo(winProbability(19, 5, 17, 5), 10);
    assertNoBannedCharacters([verdict.verdictLine, ...verdict.reasons]);
  });

  it("a bye week player is never started and never counted toward K", () => {
    const a = candidate({ playerId: "a", name: "Bijan Robinson" });
    const b = candidate({ playerId: "b", name: "Josh Jacobs" });
    const c = candidate({ playerId: "c", name: "Alvin Kamara" });
    const projections = {
      a: projection("a", { points: 20, sigma: 6 }),
      b: projection("b", { points: 18, sigma: 5 }),
      c: projection("c", { points: null, sigma: null, onBye: true }),
    };

    const verdict = computeStartSit(baseInput([a, b, c], projections, { startCount: 1 }));

    expect(verdict.starters).toEqual(["a"]);
    expect(verdict.bench).toContain("c");
    expect(verdict.bench).not.toContain("a");
    // The bye player never becomes the boundary pair's benched half.
    expect(verdict.marginPoints!).toBeCloseTo(20 - 18, 5);
    expect(verdict.confidence!).toBeCloseTo(winProbability(20, 6, 18, 5), 10);
  });

  it('an "out" player is ranked as if benched, but the verdict still sees his real projection', () => {
    const a = candidate({ playerId: "a", name: "Bijan Robinson" });
    const b = candidate({ playerId: "b", name: "Josh Jacobs" });
    const c = candidate({ playerId: "c", name: "Alvin Kamara" });
    const projections = {
      a: projection("a", { points: 20, sigma: 6 }),
      b: projection("b", { points: 18, sigma: 5 }),
      // Ruled out, but the number on file (25) would otherwise have won.
      c: projection("c", { points: 25, sigma: 7, availability: "out" }),
    };

    const verdict = computeStartSit(baseInput([a, b, c], projections, { startCount: 1 }));

    expect(verdict.starters).toEqual(["a"]);
    expect(verdict.bench[0]).toBe("b");
    expect(verdict.bench).toContain("c");
    // The out player never enters the margin or confidence pair, even though
    // his own number was the highest of the three.
    expect(verdict.marginPoints!).toBeCloseTo(20 - 18, 5);
    expect(verdict.confidence!).toBeCloseTo(winProbability(20, 6, 18, 5), 10);
    // The original projection survives for the card and the reasons: it was
    // never mutated, only excluded from ranking.
    expect(projections.c.points).toBe(25);
    expect(projections.c.availability).toBe("out");
  });

  it("when every candidate is out, on bye, or unprojected, starters is empty and the verdict explains why without throwing", () => {
    const a = candidate({ playerId: "a", name: "Bijan Robinson" });
    const b = candidate({ playerId: "b", name: "Josh Jacobs" });
    const c = candidate({ playerId: "c", name: "Alvin Kamara" });
    const projections = {
      a: projection("a", { points: null, onBye: true }),
      b: projection("b", { points: null, availability: null }),
      c: projection("c", { points: 12, availability: "out" }),
    };

    expect(() => computeStartSit(baseInput([a, b, c], projections, { startCount: 1, week: 9 }))).not.toThrow();

    const verdict = computeStartSit(baseInput([a, b, c], projections, { startCount: 1, week: 9 }));

    expect(verdict.starters).toEqual([]);
    expect(verdict.bench).toHaveLength(3);
    expect(verdict.marginPoints).toBeNull();
    expect(verdict.confidence).toBeNull();
    expect(verdict.callLabel).toBe("unmeasured");
    // The bye and injury sentences read straight off the candidates and are
    // independent of whether anyone could be ranked; only the two-player
    // templates require the missing boundary pair.
    expect(verdict.reasons).toEqual(["Bijan Robinson is on bye."]);
    expect(verdict.verdictLine.length).toBeGreaterThan(0);
    expect(verdict.verdictLine).toContain("Week 9");
    assertNoBannedCharacters([verdict.verdictLine, ...verdict.reasons]);
  });

  it("carries the requested week, season and resolved projection source straight through", () => {
    const a = candidate({ playerId: "a", name: "Bijan Robinson" });
    const b = candidate({ playerId: "b", name: "Josh Jacobs" });
    const projections = {
      a: projection("a", { points: 20, sigma: 6, week: 5 }),
      b: projection("b", { points: 18, sigma: 5, week: 5 }),
    };

    const verdict = computeStartSit(
      baseInput([a, b], projections, { startCount: 1, week: 5, season: 2026, projectionSource: "ffbeacon" }),
    );

    expect(verdict.week).toBe(5);
    expect(verdict.season).toBe(2026);
    expect(verdict.projectionSource).toBe("ffbeacon");
  });
});
