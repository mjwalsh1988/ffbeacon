import { describe, it, expect } from "vitest";
import { DEFAULT_POWER_PULSE_SETTINGS } from "./default-settings";
import { PULSE_POSITIONS } from "./types";
import { curveFor } from "./variance-curve";

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
const MEASURED_STARTABLE: Record<string, number> = {
  QB: 0.414,
  RB: 0.527,
  WR: 0.548,
  TE: 0.573,
  K: 0.507,
  DEF: 0.718,
};

describe("variance.defaultCv", () => {
  const cv = DEFAULT_POWER_PULSE_SETTINGS.variance.defaultCv;

  it("covers every position the engine can start", () => {
    for (const position of PULSE_POSITIONS) {
      expect(
        cv[position],
        `${position} has no fallback variance`,
      ).toBeGreaterThan(0);
    }
  });

  it("matches the startable-range measurement, within a rounding step", () => {
    for (const [position, measured] of Object.entries(MEASURED_STARTABLE)) {
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

  it("is only the last resort, so the curve has to exist for every position", () => {
    for (const position of PULSE_POSITIONS) {
      expect(
        curveFor("pts_ppr", position).length,
        `${position} has no PPR curve, so every fallback player at it uses one flat number`,
      ).toBeGreaterThan(1);
    }
  });

  it("keeps receivers more volatile than running backs, which is what the startable range says", () => {
    // Measuring the top 36 at every position let RB25-48, a pool of committee
    // backs, set the figure for bell cows and made running backs read as the
    // more volatile position. Across the range where starters actually live it
    // is the other way round at every band, because volume is stability.
    expect(cv.WR).toBeGreaterThan(cv.RB);
  });

  it("stays inside the clamp the engine applies to measured values", () => {
    const { minCv, maxCv } = DEFAULT_POWER_PULSE_SETTINGS.variance;
    for (const position of PULSE_POSITIONS) {
      expect(cv[position]).toBeGreaterThanOrEqual(minCv);
      expect(cv[position]).toBeLessThanOrEqual(maxCv);
    }
  });
});
