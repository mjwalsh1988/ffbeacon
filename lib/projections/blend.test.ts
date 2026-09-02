import { describe, it, expect } from "vitest";
import { blendStatLines, blendWeight } from "./blend";
import { DEFAULT_PROJECTION_SETTINGS } from "./default-settings";
import type { StatLine } from "./types";
import { scoreStatMap, type ScoringSettings } from "../league-scoring";

describe("blendWeight", () => {
  it("is min at zero current season games", () => {
    expect(blendWeight(0, DEFAULT_PROJECTION_SETTINGS)).toBe(DEFAULT_PROJECTION_SETTINGS.blend.min);
  });

  it("is max at or beyond gamesForMax", () => {
    const w = blendWeight(DEFAULT_PROJECTION_SETTINGS.blend.gamesForMax, DEFAULT_PROJECTION_SETTINGS);
    expect(w).toBeCloseTo(DEFAULT_PROJECTION_SETTINGS.blend.max, 10);
    const wBeyond = blendWeight(
      DEFAULT_PROJECTION_SETTINGS.blend.gamesForMax + 10,
      DEFAULT_PROJECTION_SETTINGS,
    );
    expect(wBeyond).toBeCloseTo(DEFAULT_PROJECTION_SETTINGS.blend.max, 10);
  });

  it("interpolates linearly between min and max", () => {
    const settings = {
      ...DEFAULT_PROJECTION_SETTINGS,
      blend: { min: 0, max: 0.5, gamesForMax: 6 },
    };
    const w = blendWeight(3, settings);
    expect(w).toBeCloseTo(0.25, 10);
  });

  it("gives every player with any games at all the max weight when gamesForMax is zero", () => {
    const settings = { ...DEFAULT_PROJECTION_SETTINGS, blend: { min: 0, max: 0.5, gamesForMax: 0 } };
    expect(blendWeight(1, settings)).toBeCloseTo(0.5, 10);
    expect(blendWeight(0, settings)).toBe(0);
  });

  it("clamps a negative or non-finite games count to zero games", () => {
    const settings = { ...DEFAULT_PROJECTION_SETTINGS, blend: { min: 0.1, max: 0.5, gamesForMax: 6 } };
    expect(blendWeight(-3, settings)).toBe(0.1);
    expect(blendWeight(Number.NaN, settings)).toBe(0.1);
  });
});

describe("blendStatLines", () => {
  const beacon: StatLine = { gp: 1, rec_tgt: 8, rec: 5.5, rec_yd: 62.7, rec_td: 0.4, fum_lost: 0.05 };
  const sleeper: StatLine = { gp: 1, rec_tgt: 8, rec: 5.5, rec_yd: 62.7, rec_td: 0.4, fum_lost: 0.05 };

  it("returns the sleeper line unchanged at weight 0, when both sides carry the same keys", () => {
    const differentBeacon: StatLine = { gp: 1, rec_tgt: 9, rec: 6.1, rec_yd: 70.4, rec_td: 0.5, fum_lost: 0.08 };
    const result = blendStatLines(differentBeacon, sleeper, 0);
    expect(result).toEqual(sleeper);
  });

  it("returns the beacon line unchanged at weight 1, when both sides carry the same keys", () => {
    const differentSleeper: StatLine = { gp: 1, rec_tgt: 7, rec: 4.9, rec_yd: 55.3, rec_td: 0.3, fum_lost: 0.03 };
    const result = blendStatLines(beacon, differentSleeper, 1);
    expect(result).toEqual(beacon);
  });

  it("blends shared keys as a weighted average", () => {
    const b: StatLine = { gp: 1, rec: 10 };
    const s: StatLine = { gp: 1, rec: 4 };
    const result = blendStatLines(b, s, 0.25);
    expect(result.rec).toBeCloseTo(0.25 * 10 + 0.75 * 4, 10);
  });

  it("carries a beacon-only key through at its full value rather than diluting it against an unasserted sleeper zero", () => {
    const b: StatLine = { gp: 1, rec_tgt: 8 };
    const s: StatLine = { gp: 1 };
    const result = blendStatLines(b, s, 0.5);
    expect(result.rec_tgt).toBe(8);
  });

  it("carries a sleeper-only key through at its full value rather than dropping real information", () => {
    const b: StatLine = { gp: 1 };
    const s: StatLine = { gp: 1, pass_sack: 2.1 };
    const result = blendStatLines(b, s, 0.5);
    expect(result.pass_sack).toBe(2.1);
  });

  it("this one-sided passthrough holds at every weight, including 0 and 1", () => {
    const b: StatLine = { gp: 1, rec_tgt: 8 };
    const s: StatLine = { gp: 1, pass_sack: 2.1 };
    for (const w of [0, 0.3, 0.7, 1]) {
      const result = blendStatLines(b, s, w);
      expect(result.rec_tgt).toBe(8);
      expect(result.pass_sack).toBe(2.1);
    }
  });

  it("treats a non-finite value on either side as absent", () => {
    const b: StatLine = { gp: 1, rec: Number.NaN };
    const s: StatLine = { gp: 1, rec: 4 };
    const result = blendStatLines(b, s, 0.5);
    expect(result.rec).toBe(4);
  });

  it("always sets gp to 1 rather than blending it", () => {
    const b: StatLine = { gp: 1, rec: 5 };
    const s: StatLine = { gp: 1, rec: 5 };
    const result = blendStatLines(b, s, 0.5);
    expect(result.gp).toBe(1);
  });

  it("omits a key absent from both sides", () => {
    const b: StatLine = { gp: 1 };
    const s: StatLine = { gp: 1 };
    const result = blendStatLines(b, s, 0.5);
    expect(result.rec).toBeUndefined();
  });
});

describe("end to end: convert, calibrate, blend, then price", () => {
  it("produces a sane, finite total under both a plain PPR map and a TE premium map", async () => {
    const { toStatLine } = await import("./convert");
    const { calibrateStatLine } = await import("./calibrate");

    const beaconLine = toStatLine(
      {
        position: "WR",
        opportunity: { targets: 9, carries: 0.5, passAttempts: 0 },
        player: {
          catchRate: 0.71,
          yardsPerReception: 12.8,
          recTdPerTarget: 0.06,
          yardsPerCarry: 7.0,
          rushTdPerCarry: 0.03,
          completionRate: null,
          yardsPerAttempt: null,
          passTdPerAttempt: null,
          intPerAttempt: null,
          fumbleLostPerTouch: 0.004,
          weightedGames: 8,
        },
        league: {
          catchRate: 0.62,
          yardsPerReception: 11.4,
          recTdPerTarget: 0.045,
          yardsPerCarry: 6.0,
          rushTdPerCarry: 0.02,
          completionRate: null,
          yardsPerAttempt: null,
          passTdPerAttempt: null,
          intPerAttempt: null,
          fumbleLostPerTouch: 0.006,
          weightedGames: 200,
        },
        scoringMultiplier: 1.05,
      },
      DEFAULT_PROJECTION_SETTINGS,
    );

    const calibrated = calibrateStatLine(beaconLine, "WR", 9.5, 17.2, DEFAULT_PROJECTION_SETTINGS);

    // A real Sleeper WR projection stat line, in Sleeper's own vocabulary.
    const sleeperLine: StatLine = {
      gp: 1,
      rec_tgt: 8.4,
      rec: 5.6,
      rec_yd: 68.9,
      rec_td: 0.41,
      rush_att: 0.2,
      rush_yd: 1.4,
      fum_lost: 0.03,
    };

    const weight = blendWeight(7, DEFAULT_PROJECTION_SETTINGS);
    const blended = blendStatLines(calibrated, sleeperLine, weight);

    expect(blended.gp).toBe(1);
    for (const [key, value] of Object.entries(blended)) {
      expect(Number.isFinite(value), `${key} should be finite`).toBe(true);
      expect(value, `${key} should be non-negative`).toBeGreaterThanOrEqual(0);
    }

    const fullPpr: ScoringSettings = {
      rec: 1,
      rec_yd: 0.1,
      rec_td: 6,
      rush_yd: 0.1,
      rush_td: 6,
      pass_yd: 0.04,
      pass_td: 4,
      pass_int: -1,
      fum_lost: -2,
    };
    const tePremium: ScoringSettings = { ...fullPpr, bonus_rec_te: 0.5 };

    const pprPoints = scoreStatMap(blended, fullPpr);
    const tePoints = scoreStatMap(blended, tePremium);

    expect(pprPoints).not.toBeNull();
    expect(Number.isFinite(pprPoints as number)).toBe(true);
    expect(pprPoints as number).toBeGreaterThan(0);
    expect(pprPoints as number).toBeLessThan(60);

    // A WR stat line carries no bonus_rec_te, so a TE premium league prices
    // it identically to a plain PPR league: the premium is a no-op here.
    expect(tePoints).toBeCloseTo(pprPoints as number, 8);
  });
});
