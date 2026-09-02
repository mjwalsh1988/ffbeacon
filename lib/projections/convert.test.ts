import { describe, it, expect } from "vitest";
import { shrinkRate, toStatLine, type ConversionInput } from "./convert";
import { DEFAULT_PROJECTION_SETTINGS } from "./default-settings";
import type { EfficiencyRates } from "./types";
import { scoreStatMap, type ScoringSettings } from "../league-scoring";

const rates = (overrides: Partial<EfficiencyRates> = {}): EfficiencyRates => ({
  catchRate: null,
  yardsPerReception: null,
  recTdPerTarget: null,
  yardsPerCarry: null,
  rushTdPerCarry: null,
  completionRate: null,
  yardsPerAttempt: null,
  passTdPerAttempt: null,
  intPerAttempt: null,
  fumbleLostPerTouch: null,
  weightedGames: 0,
  ...overrides,
});

const LEAGUE_WR: EfficiencyRates = rates({
  catchRate: 0.62,
  yardsPerReception: 11.4,
  recTdPerTarget: 0.045,
  yardsPerCarry: 6.0,
  rushTdPerCarry: 0.02,
  fumbleLostPerTouch: 0.006,
  weightedGames: 200,
});

describe("shrinkRate", () => {
  it("returns the league rate whole when the player rate is null", () => {
    expect(shrinkRate(null, 0.5, 10, 24)).toBe(0.5);
  });

  it("returns the player rate whole when the league rate is null", () => {
    expect(shrinkRate(0.7, null, 10, 24)).toBe(0.7);
  });

  it("returns null when both rates are null", () => {
    expect(shrinkRate(null, null, 10, 24)).toBeNull();
  });

  it("weighs the player rate by weightedGames and the league rate by priorGames", () => {
    // n=4, prior=24: (4*1.0 + 24*0.5) / 28 = 16/28
    const result = shrinkRate(1.0, 0.5, 4, 24);
    expect(result).toBeCloseTo(16 / 28, 10);
  });

  it("does not divide by zero when both weightedGames and priorGames are zero", () => {
    const result = shrinkRate(0.8, 0.4, 0, 0);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result as number)).toBe(true);
    // With no basis for either side, the league (prior) rate is the safe default.
    expect(result).toBe(0.4);
  });

  it("treats a non-finite player rate the same as null", () => {
    expect(shrinkRate(Number.POSITIVE_INFINITY, 0.3, 10, 24)).toBe(0.3);
  });
});

describe("toStatLine, receiving position (WR)", () => {
  const baseInput: ConversionInput = {
    position: "WR",
    opportunity: { targets: 8, carries: 1, passAttempts: 0 },
    player: rates({ weightedGames: 6 }),
    league: LEAGUE_WR,
    scoringMultiplier: 1,
  };

  it("always emits gp: 1", () => {
    const line = toStatLine(baseInput, DEFAULT_PROJECTION_SETTINGS);
    expect(line.gp).toBe(1);
  });

  it("emits rec_tgt as the literal opportunity even when no player rates exist", () => {
    const line = toStatLine(baseInput, DEFAULT_PROJECTION_SETTINGS);
    expect(line.rec_tgt).toBe(8);
  });

  it("falls back to league rates whole when the player has no measurement", () => {
    const line = toStatLine(baseInput, DEFAULT_PROJECTION_SETTINGS);
    // catchRate falls back to league 0.62 whole (player null, priorGames irrelevant here).
    expect(line.rec).toBeCloseTo(8 * 0.62, 10);
    expect(line.rec_yd).toBeCloseTo((8 * 0.62) * 11.4, 10);
  });

  it("shrinks a player rate toward the league mean rather than using it whole", () => {
    const input: ConversionInput = {
      ...baseInput,
      player: rates({ catchRate: 0.9, weightedGames: 4 }),
    };
    const line = toStatLine(input, DEFAULT_PROJECTION_SETTINGS);
    // n=4, prior=24: (4*0.9 + 24*0.62)/28
    const expectedCatchRate = (4 * 0.9 + 24 * 0.62) / 28;
    expect(line.rec).toBeCloseTo(8 * expectedCatchRate, 10);
  });

  it("applies the scoring multiplier to touchdown rates only, not to yardage", () => {
    const flat = toStatLine(baseInput, DEFAULT_PROJECTION_SETTINGS);
    const boosted = toStatLine(
      { ...baseInput, scoringMultiplier: 1.5 },
      DEFAULT_PROJECTION_SETTINGS,
    );
    expect(boosted.rec_td).toBeCloseTo((flat.rec_td as number) * 1.5, 10);
    expect(boosted.rec_yd).toBeCloseTo(flat.rec_yd as number, 10);
    expect(boosted.rec).toBeCloseTo(flat.rec as number, 10);
  });

  it("omits rec and rec_yd, but keeps rec_tgt, when no rate exists on either side", () => {
    const input: ConversionInput = {
      ...baseInput,
      player: rates({ weightedGames: 6 }),
      league: rates(),
    };
    const line = toStatLine(input, DEFAULT_PROJECTION_SETTINGS);
    expect(line.rec_tgt).toBe(8);
    expect(line.rec).toBeUndefined();
    expect(line.rec_yd).toBeUndefined();
    expect(line.rec_td).toBeUndefined();
  });

  it("carries rushing keys too, since a WR can also carry the ball", () => {
    const line = toStatLine(baseInput, DEFAULT_PROJECTION_SETTINGS);
    expect(line.rush_att).toBe(1);
    // League rushing rates exist, so rush_yd/rush_td are computed too.
    expect(line.rush_yd).toBeGreaterThan(0);
  });

  it("never emits passing keys for a WR", () => {
    const line = toStatLine(baseInput, DEFAULT_PROJECTION_SETTINGS);
    expect(line.pass_att).toBeUndefined();
    expect(line.pass_cmp).toBeUndefined();
    expect(line.pass_yd).toBeUndefined();
  });

  it("never emits pts_ppr, pts_half_ppr or pts_std", () => {
    const line = toStatLine(baseInput, DEFAULT_PROJECTION_SETTINGS);
    expect(line.pts_ppr).toBeUndefined();
    expect(line.pts_half_ppr).toBeUndefined();
    expect(line.pts_std).toBeUndefined();
  });

  it("never emits bonus_rec_te for a non-tight-end", () => {
    const line = toStatLine(baseInput, DEFAULT_PROJECTION_SETTINGS);
    expect(line.bonus_rec_te).toBeUndefined();
  });

  it("emits fum_lost from combined carry and reception touches", () => {
    const line = toStatLine(baseInput, DEFAULT_PROJECTION_SETTINGS);
    const receptions = line.rec as number;
    const carries = line.rush_att as number;
    expect(line.fum_lost).toBeCloseTo((receptions + carries) * LEAGUE_WR.fumbleLostPerTouch!, 8);
  });

  it("every emitted value is finite and non-negative", () => {
    const line = toStatLine(baseInput, DEFAULT_PROJECTION_SETTINGS);
    for (const [key, value] of Object.entries(line)) {
      expect(Number.isFinite(value), `${key} should be finite`).toBe(true);
      expect(value, `${key} should be non-negative`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("toStatLine, tight end bonus_rec_te", () => {
  const teInput: ConversionInput = {
    position: "TE",
    opportunity: { targets: 6, carries: 0, passAttempts: 0 },
    player: rates({ weightedGames: 6 }),
    league: rates({ catchRate: 0.68, yardsPerReception: 9.8, recTdPerTarget: 0.05, weightedGames: 200 }),
    scoringMultiplier: 1,
  };

  it("emits bonus_rec_te equal to the reception count when rec is computed", () => {
    const line = toStatLine(teInput, DEFAULT_PROJECTION_SETTINGS);
    expect(line.rec).toBeDefined();
    expect(line.bonus_rec_te).toBe(line.rec);
  });

  it("omits bonus_rec_te when rec itself is omitted", () => {
    const noRateInput: ConversionInput = {
      ...teInput,
      league: rates(),
    };
    const line = toStatLine(noRateInput, DEFAULT_PROJECTION_SETTINGS);
    expect(line.rec).toBeUndefined();
    expect(line.bonus_rec_te).toBeUndefined();
  });

  it("prices a TE premium league correctly because bonus_rec_te is present, matching Sleeper's own behaviour", () => {
    const line = toStatLine(teInput, DEFAULT_PROJECTION_SETTINGS);
    const plainPpr: ScoringSettings = {
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
    const tePremiumLeague: ScoringSettings = { ...plainPpr, bonus_rec_te: 0.5 };

    const basePoints = scoreStatMap(line, plainPpr) as number;
    const premiumPoints = scoreStatMap(line, tePremiumLeague) as number;

    // The whole premium is 0.5 points per reception, and nothing else moves.
    expect(premiumPoints - basePoints).toBeCloseTo(0.5 * (line.rec as number), 8);
  });
});

describe("toStatLine, passing position (QB)", () => {
  const qbInput: ConversionInput = {
    position: "QB",
    opportunity: { targets: 0, carries: 4, passAttempts: 32 },
    player: rates({ weightedGames: 8 }),
    league: rates({
      completionRate: 0.64,
      yardsPerAttempt: 7.2,
      passTdPerAttempt: 0.045,
      intPerAttempt: 0.02,
      yardsPerCarry: 4.5,
      rushTdPerCarry: 0.02,
      fumbleLostPerTouch: 0.01,
      weightedGames: 200,
    }),
    scoringMultiplier: 1,
  };

  it("emits pass_att as the literal opportunity", () => {
    const line = toStatLine(qbInput, DEFAULT_PROJECTION_SETTINGS);
    expect(line.pass_att).toBe(32);
  });

  it("derives pass_inc from pass_att minus pass_cmp, floored at zero", () => {
    const line = toStatLine(qbInput, DEFAULT_PROJECTION_SETTINGS);
    const cmp = line.pass_cmp as number;
    expect(line.pass_inc).toBeCloseTo(32 - cmp, 10);
    expect(line.pass_inc as number).toBeGreaterThanOrEqual(0);
  });

  it("omits pass_cmp and pass_inc together when the completion rate is unavailable", () => {
    const input: ConversionInput = {
      ...qbInput,
      player: rates({ weightedGames: 8 }),
      league: rates({
        yardsPerAttempt: 7.2,
        passTdPerAttempt: 0.045,
        yardsPerCarry: 4.5,
        weightedGames: 200,
      }),
    };
    const line = toStatLine(input, DEFAULT_PROJECTION_SETTINGS);
    expect(line.pass_cmp).toBeUndefined();
    expect(line.pass_inc).toBeUndefined();
  });

  it("never emits receiving keys for a quarterback", () => {
    const line = toStatLine(qbInput, DEFAULT_PROJECTION_SETTINGS);
    expect(line.rec).toBeUndefined();
    expect(line.rec_tgt).toBeUndefined();
    expect(line.bonus_rec_te).toBeUndefined();
  });

  it("computes fum_lost from rushing touches only, since sacks are outside this module's inputs", () => {
    const line = toStatLine(qbInput, DEFAULT_PROJECTION_SETTINGS);
    const carries = line.rush_att as number;
    expect(line.fum_lost).toBeCloseTo(carries * 0.01, 8);
  });
});
