import { describe, it, expect } from "vitest";
import { calibrateStatLine } from "./calibrate";
import { DEFAULT_PROJECTION_SETTINGS } from "./default-settings";
import type { StatLine } from "./types";

const WR_LINE: StatLine = {
  gp: 1,
  rec_tgt: 8,
  rec: 5.5,
  rec_yd: 62.7,
  rec_td: 0.4,
  rush_att: 0.5,
  rush_yd: 3.2,
  fum_lost: 0.05,
};

describe("calibrateStatLine", () => {
  it("returns the input unchanged when calibration is disabled", () => {
    const settings = {
      ...DEFAULT_PROJECTION_SETTINGS,
      calibration: { ...DEFAULT_PROJECTION_SETTINGS.calibration, enabled: false },
    };
    const result = calibrateStatLine(WR_LINE, "WR", 12, 15, settings);
    expect(result).toEqual(WR_LINE);
  });

  it("scales every non-gp value by the same factor derived from the calibrated total", () => {
    // WR slope 0.85, mean 10, projected 20: calibrated = 10 + 0.85*10 = 18.5, factor = 0.925
    const result = calibrateStatLine(WR_LINE, "WR", 10, 20, DEFAULT_PROJECTION_SETTINGS);
    const factor = 0.925;
    expect(result.rec).toBeCloseTo(WR_LINE.rec * factor, 8);
    expect(result.rec_yd).toBeCloseTo(WR_LINE.rec_yd * factor, 8);
    expect(result.rush_yd).toBeCloseTo(WR_LINE.rush_yd * factor, 8);
    expect(result.fum_lost).toBeCloseTo(WR_LINE.fum_lost * factor, 8);
  });

  it("keeps a stat line internally consistent: receptions times yards per reception still equals receiving yards", () => {
    const result = calibrateStatLine(WR_LINE, "WR", 10, 20, DEFAULT_PROJECTION_SETTINGS);
    const yardsPerReception = WR_LINE.rec_yd / WR_LINE.rec;
    expect((result.rec as number) * yardsPerReception).toBeCloseTo(result.rec_yd as number, 6);
  });

  it("does not scale gp, since it is a game count rather than a quantity of production", () => {
    const result = calibrateStatLine(WR_LINE, "WR", 10, 20, DEFAULT_PROJECTION_SETTINGS);
    expect(result.gp).toBe(1);
  });

  it("returns the input unchanged when projectedPoints is zero or negative", () => {
    expect(calibrateStatLine(WR_LINE, "WR", 10, 0, DEFAULT_PROJECTION_SETTINGS)).toEqual(WR_LINE);
    expect(calibrateStatLine(WR_LINE, "WR", 10, -5, DEFAULT_PROJECTION_SETTINGS)).toEqual(WR_LINE);
  });

  it("returns the input unchanged when either points value is non-finite", () => {
    expect(
      calibrateStatLine(WR_LINE, "WR", Number.NaN, 20, DEFAULT_PROJECTION_SETTINGS),
    ).toEqual(WR_LINE);
    expect(
      calibrateStatLine(WR_LINE, "WR", 10, Number.POSITIVE_INFINITY, DEFAULT_PROJECTION_SETTINGS),
    ).toEqual(WR_LINE);
  });

  it("floors a calibrated total at zero rather than letting the factor go negative", () => {
    // A steep negative correction: mean far below projected, tiny slope.
    const settings = {
      ...DEFAULT_PROJECTION_SETTINGS,
      calibration: {
        enabled: true,
        slope: { ...DEFAULT_PROJECTION_SETTINGS.calibration.slope, WR: -5 },
      },
    };
    const result = calibrateStatLine(WR_LINE, "WR", 2, 20, settings);
    // calibrated would be 2 + (-5)*18 = -88, floored to 0, factor = 0.
    for (const [key, value] of Object.entries(result)) {
      if (key === "gp") continue;
      expect(value).toBe(0);
    }
  });

  it("applies each position's own slope", () => {
    const qbResult = calibrateStatLine(WR_LINE, "QB", 10, 20, DEFAULT_PROJECTION_SETTINGS);
    const teResult = calibrateStatLine(WR_LINE, "TE", 10, 20, DEFAULT_PROJECTION_SETTINGS);
    expect(qbResult.rec).not.toBeCloseTo(teResult.rec as number, 8);
  });
});

/**
 * Review findings, pinned.
 *
 * The calibration factor puts the projection in the DENOMINATOR, so it grows
 * without bound as the projection approaches zero. The caller restricts
 * calibration to the startable range, which handles the normal case, but a thin
 * pool degrades that cut to the pool's own minimum and lets a near-zero row
 * through. These are the guards that close it.
 */
describe("calibrateStatLine, the near-zero blow-up", () => {
  const settings = DEFAULT_PROJECTION_SETTINGS;

  it("leaves a near-zero projection alone rather than inflating it about thirtyfold", () => {
    const line: StatLine = { gp: 1, pass_yd: 3, pass_td: 0.01 };
    // QB slope 0.67 against a positional mean of 20: without the floor this
    // would scale by roughly (20 + 0.67 * (0.2 - 20)) / 0.2, about 33.
    const out = calibrateStatLine(line, "QB", 20, 0.2, settings);
    expect(out).toEqual(line);
  });

  it("still calibrates a real startable projection", () => {
    const line: StatLine = { gp: 1, pass_yd: 300, pass_td: 2 };
    const out = calibrateStatLine(line, "QB", 20, 28, settings);
    expect(out.pass_yd).not.toBe(300);
    // Above the mean compresses downward.
    expect(out.pass_yd as number).toBeLessThan(300);
  });

  it("refuses a factor larger than the cap even above the points floor", () => {
    // A projection just above the floor against a very high positional mean
    // still produces a runaway factor. The cap is the second guard.
    const line: StatLine = { gp: 1, rec: 1, rec_yd: 10 };
    const out = calibrateStatLine(line, "WR", 60, 2.5, settings);
    expect(out).toEqual(line);
  });

  it("does not scale gp, which is a count of games and not production", () => {
    const line: StatLine = { gp: 1, rec: 6, rec_yd: 80 };
    const out = calibrateStatLine(line, "WR", 12, 18, settings);
    expect(out.gp).toBe(1);
    expect(out.rec).not.toBe(6);
  });
});
