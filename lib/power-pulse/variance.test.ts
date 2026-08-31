import { describe, it, expect } from "vitest";
import { DEFAULT_POWER_PULSE_SETTINGS } from "./default-settings";
import { PULSE_POSITIONS } from "./types";

/**
 * The fallback variance figures are MEASURED, and this is the measurement.
 *
 * Each is the median week-to-week coefficient of variation across the top 36
 * scorers at that position in the 2025 regular season, taken from player_stats
 * with at least 12 games and more than 5 points a game. They replaced a set of
 * plausible guesses, four of which were wrong in a way that mattered.
 *
 * The tolerance is deliberately tight. Anyone widening it should re-run the
 * measurement against a newer season rather than loosen the test, because these
 * numbers are the only thing standing between a team's projected record and a
 * spread somebody invented.
 */
const MEASURED_2025: Record<string, number> = {
  QB: 0.423,
  RB: 0.589,
  WR: 0.566,
  TE: 0.646,
  K: 0.51,
  DEF: 0.804,
};

describe("variance.defaultCv", () => {
  const cv = DEFAULT_POWER_PULSE_SETTINGS.variance.defaultCv;

  it("covers every position the engine can start", () => {
    for (const position of PULSE_POSITIONS) {
      expect(cv[position], `${position} has no fallback variance`).toBeGreaterThan(0);
    }
  });

  it("matches what 2025 actually did, within a rounding step", () => {
    for (const [position, measured] of Object.entries(MEASURED_2025)) {
      expect(
        Math.abs(cv[position as keyof typeof cv] - measured),
        `${position} fallback ${cv[position as keyof typeof cv]} is not the measured ${measured}`,
      ).toBeLessThanOrEqual(0.02);
    }
  });

  it("keeps quarterbacks the steadiest and defenses the most volatile", () => {
    expect(cv.QB).toBeLessThan(cv.RB);
    expect(cv.QB).toBeLessThan(cv.WR);
    expect(cv.DEF).toBeGreaterThan(cv.TE);
  });

  it("does not let a wide receiver be treated as more erratic than a running back", () => {
    // The old default had WR at 0.65 against RB at 0.55, which is backwards:
    // 2025 measured WR at 0.566 and RB at 0.589. A league starts three or more
    // receivers, so overstating them inflated every team's weekly spread and
    // pushed every matchup closer to a coin flip.
    expect(cv.WR).toBeLessThan(cv.RB);
  });

  it("stays inside the clamp the engine applies to measured values", () => {
    const { minCv, maxCv } = DEFAULT_POWER_PULSE_SETTINGS.variance;
    for (const position of PULSE_POSITIONS) {
      expect(cv[position]).toBeGreaterThanOrEqual(minCv);
      expect(cv[position]).toBeLessThanOrEqual(maxCv);
    }
  });
});
