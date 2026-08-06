import { describe, it, expect } from "vitest";
import {
  computeManualMarginal,
  replacementRankFor,
  type ManualMarginalInput,
} from "./manual";
import { DEFAULT_FAAB_SETTINGS } from "./default-settings";
import type { MarginalWeek } from "./types";

const R = DEFAULT_FAAB_SETTINGS.manualReplacement;

/**
 * A projection curve that decays gently and never bottoms out. A curve that
 * hits zero partway down would make every deep league share the same
 * replacement level and quietly neuter the league-size tests.
 */
function curve(top: number, count: number, step = 0.3): number[] {
  return Array.from({ length: count }, (_, i) => Math.max(1, top - i * step));
}

function weeks(count: number): MarginalWeek[] {
  return Array.from({ length: count }, (_, i) => ({
    week: i + 5,
    startsForYou: true,
    pointsAdded: 0,
    opponent: "BUF",
    opponentMultiplier: 1,
  }));
}

function baseInput(overrides: Partial<ManualMarginalInput> = {}): ManualMarginalInput {
  return {
    position: "WR",
    projectedPointsPerWeek: 22,
    positionCurve: curve(30, 80),
    teams: 12,
    offensiveStarters: 9,
    weeksRemaining: 8,
    weeks: weeks(8),
    settings: R,
    ...overrides,
  };
}

describe("replacementRankFor", () => {
  it("scales with league size", () => {
    const ten = replacementRankFor("WR", 10, 9, R)!;
    const fourteen = replacementRankFor("WR", 14, 9, R)!;
    expect(fourteen).toBeGreaterThan(ten);
  });

  it("scales with starter count, so deeper lineups mean deeper replacement", () => {
    const shallow = replacementRankFor("RB", 12, 7, R)!;
    const deep = replacementRankFor("RB", 12, 12, R)!;
    expect(deep).toBeGreaterThan(shallow);
  });

  it("keeps kickers and defenses flat, because nobody starts two", () => {
    expect(replacementRankFor("K", 12, 7, R)).toBe(replacementRankFor("K", 12, 12, R));
    expect(replacementRankFor("DEF", 12, 7, R)).toBe(replacementRankFor("DEF", 12, 12, R));
  });

  it("runs deeper at receiver than at quarterback in a one-QB league", () => {
    expect(replacementRankFor("WR", 12, 9, R)!).toBeGreaterThan(
      replacementRankFor("QB", 12, 9, R)!,
    );
  });

  it("returns null for a position we have no shape for", () => {
    expect(replacementRankFor("LB", 12, 9, R)).toBeNull();
  });
});

describe("computeManualMarginal", () => {
  it("prices the gap over replacement, not the raw projection", () => {
    // 12 teams at 3.9 receivers each puts replacement around the 47th, which
    // this curve has at roughly 16 points a week.
    const result = computeManualMarginal(baseInput());
    const replacement = result.replacementPointsPerWeek!;
    expect(result.marginal?.netPointsPerWeek).toBeCloseTo(22 - replacement, 6);
    // The whole point: he is not worth his 22, he is worth what he adds.
    expect(result.marginal?.netPointsPerWeek).toBeLessThan(22);
  });

  it("calls a below-replacement player what he is", () => {
    const result = computeManualMarginal(baseInput({ projectedPointsPerWeek: 1 }));
    expect(result.isBelowReplacement).toBe(true);
    expect(result.marginal?.isBenchOnly).toBe(true);
    expect(result.marginal?.netPointsPerWeek).toBe(0);
  });

  it("makes the same player worth more in a deeper league", () => {
    const shallow = computeManualMarginal(baseInput({ teams: 8 }));
    const deep = computeManualMarginal(baseInput({ teams: 16 }));
    // A deeper league has a worse last startable receiver, so the same
    // projection buys more.
    expect(deep.marginal!.netPointsPerWeek).toBeGreaterThan(
      shallow.marginal!.netPointsPerWeek,
    );
  });

  it("returns nothing to price when there is no projection", () => {
    const result = computeManualMarginal(baseInput({ projectedPointsPerWeek: null }));
    expect(result.marginal).toBeNull();
  });

  it("returns nothing to price when the position has no curve", () => {
    const result = computeManualMarginal(baseInput({ positionCurve: [] }));
    expect(result.marginal).toBeNull();
  });

  it("falls off the end of a short curve rather than throwing", () => {
    const result = computeManualMarginal(
      baseInput({ positionCurve: [20, 18, 16], teams: 14 }),
    );
    expect(result.replacementPointsPerWeek).toBe(16);
    expect(result.marginal?.netPointsPerWeek).toBeCloseTo(6, 6);
  });

  it("carries the remaining schedule through for the matchup read", () => {
    const result = computeManualMarginal(baseInput({ weeks: weeks(6) }));
    expect(result.marginal?.weeks).toHaveLength(6);
    expect(result.marginal?.weeksConsidered).toBe(6);
  });
});
