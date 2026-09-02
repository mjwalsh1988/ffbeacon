import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECTION_SETTINGS } from "./default-settings";
import type { ProjectionSettings } from "./default-settings";
import type { GameEnvironment, TeamVolume } from "./types";
import type { PlayerStatRow } from "./usage";
import { applyEnvironment, computeTeamVolume, environmentEffect } from "./volume";

const SETTINGS = DEFAULT_PROJECTION_SETTINGS;

function withEnvironment(overrides: Partial<ProjectionSettings["environment"]>): ProjectionSettings {
  return { ...SETTINGS, environment: { ...SETTINGS.environment, ...overrides } };
}

function row(
  overrides: Partial<PlayerStatRow> & Pick<PlayerStatRow, "playerId" | "team" | "season" | "week">,
): PlayerStatRow {
  return {
    position: "WR",
    gp: 1,
    offSnaps: null,
    targets: null,
    receptions: 0,
    recYards: 0,
    recTds: 0,
    carries: 0,
    rushYards: 0,
    rushTds: 0,
    rushRedZoneAttempts: 0,
    passAttempts: 0,
    passCompletions: 0,
    passYards: 0,
    passTds: 0,
    interceptions: 0,
    fumblesLost: 0,
    ...overrides,
  };
}

describe("environmentEffect", () => {
  it("returns the neutral effect when there is no game at all", () => {
    const effect = environmentEffect(null, SETTINGS);
    expect(effect).toEqual({ volume: 1, scoring: 1, rushShift: 0 });
  });

  it("returns the neutral effect when the environment feature is disabled, even with a real line", () => {
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: 30, spread: -7 };
    const effect = environmentEffect(env, withEnvironment({ enabled: false }));
    expect(effect).toEqual({ volume: 1, scoring: 1, rushShift: 0 });
  });

  it("returns a neutral volume and scoring when impliedTotal is null, never a fabricated neutral game", () => {
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: null, spread: null };
    const effect = environmentEffect(env, SETTINGS);
    expect(effect).toEqual({ volume: 1, scoring: 1, rushShift: 0 });
  });

  it("returns rushShift exactly 0 when spread is null, independent of a present impliedTotal", () => {
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: 30, spread: null };
    const effect = environmentEffect(env, SETTINGS);
    expect(effect.rushShift).toBe(0);
    // The total is still applied even though the spread is missing: each
    // piece of a game line is an independent adjustment we did or did not
    // make, not an all-or-nothing switch.
    expect(effect.volume).toBeGreaterThan(1);
  });

  it("raises volume above 1 for a richer-than-average implied total", () => {
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: 27, spread: null };
    const effect = environmentEffect(env, SETTINGS);
    const ratio = 27 / SETTINGS.environment.leagueAverageImpliedTotal;
    expect(effect.volume).toBeCloseTo(ratio ** SETTINGS.environment.totalWeight, 10);
  });

  it("moves scoring on twice the exponent of volume, so scoring is the more sensitive of the two", () => {
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: 27, spread: null };
    // Widen the band so neither multiplier clamps and the raw exponents are
    // directly comparable.
    const effect = environmentEffect(env, withEnvironment({ totalMin: 0, totalMax: 100 }));
    const ratio = 27 / SETTINGS.environment.leagueAverageImpliedTotal;
    expect(effect.scoring).toBeCloseTo(ratio ** (SETTINGS.environment.totalWeight * 2), 10);
    // Both multipliers move the same direction (richer game, both above 1),
    // and scoring moves further from 1 than volume does.
    expect(effect.scoring - 1).toBeGreaterThan(effect.volume - 1);
  });

  it("clamps volume and scoring at the configured ceiling for an extreme implied total", () => {
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: 100, spread: null };
    const effect = environmentEffect(env, SETTINGS);
    expect(effect.volume).toBe(SETTINGS.environment.totalMax);
    expect(effect.scoring).toBe(SETTINGS.environment.totalMax);
  });

  it("clamps volume and scoring at the configured floor for a very low implied total", () => {
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: 1, spread: null };
    const effect = environmentEffect(env, SETTINGS);
    expect(effect.volume).toBe(SETTINGS.environment.totalMin);
    expect(effect.scoring).toBe(SETTINGS.environment.totalMin);
  });

  it("gives a favoured team (negative spread) a POSITIVE rushShift, toward more rushing", () => {
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: null, spread: -7 };
    const effect = environmentEffect(env, SETTINGS);
    expect(effect.rushShift).toBeGreaterThan(0);
    expect(effect.rushShift).toBeCloseTo(7 * SETTINGS.environment.spreadWeight, 10);
  });

  it("gives an underdog team (positive spread) a NEGATIVE rushShift, toward more passing", () => {
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: null, spread: 7 };
    const effect = environmentEffect(env, SETTINGS);
    expect(effect.rushShift).toBeLessThan(0);
    expect(effect.rushShift).toBeCloseTo(-7 * SETTINGS.environment.spreadWeight, 10);
  });

  it("clamps rushShift at scriptMax for a large favourite", () => {
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: null, spread: -30 };
    const effect = environmentEffect(env, SETTINGS);
    expect(effect.rushShift).toBe(SETTINGS.environment.scriptMax);
  });

  it("clamps rushShift at negative scriptMax for a large underdog", () => {
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: null, spread: 30 };
    const effect = environmentEffect(env, SETTINGS);
    expect(effect.rushShift).toBe(-SETTINGS.environment.scriptMax);
  });

  it("falls back to a neutral volume and scoring rather than NaN when the league average is zero", () => {
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: 24, spread: null };
    const effect = environmentEffect(env, withEnvironment({ leagueAverageImpliedTotal: 0 }));
    expect(effect.volume).toBe(1);
    expect(effect.scoring).toBe(1);
  });

  it("falls back to a neutral volume and scoring rather than NaN for a negative implied total", () => {
    // A fractional exponent of a negative ratio is NaN in floating point.
    const env: GameEnvironment = { team: "AAA", opponent: "BBB", impliedTotal: -10, spread: null };
    const effect = environmentEffect(env, SETTINGS);
    expect(effect.volume).toBe(1);
    expect(effect.scoring).toBe(1);
  });
});

describe("computeTeamVolume", () => {
  const params = { currentSeason: 2026, latestWeek: 1 };

  it("uses the MAXIMUM off_snp on a team-week for offensive snaps, not the sum", () => {
    const rows: PlayerStatRow[] = [
      row({ playerId: "qb", team: "AAA", season: 2026, week: 1, position: "QB", offSnaps: 62 }),
      row({ playerId: "wr", team: "AAA", season: 2026, week: 1, position: "WR", offSnaps: 58 }),
    ];
    const volumes = computeTeamVolume(rows, params, SETTINGS);
    expect(volumes.get("AAA")?.offensiveSnaps).toBe(62);
  });

  it("sums pass attempts and rush attempts across a team-week", () => {
    const rows: PlayerStatRow[] = [
      row({ playerId: "qb", team: "AAA", season: 2026, week: 1, position: "QB", passAttempts: 30 }),
      row({ playerId: "rb1", team: "AAA", season: 2026, week: 1, position: "RB", carries: 15 }),
      row({ playerId: "rb2", team: "AAA", season: 2026, week: 1, position: "RB", carries: 5 }),
    ];
    const volumes = computeTeamVolume(rows, params, SETTINGS);
    expect(volumes.get("AAA")?.passAttempts).toBe(30);
    expect(volumes.get("AAA")?.rushAttempts).toBe(20);
  });

  it("excludes rows with no team from every team's aggregation", () => {
    const rows: PlayerStatRow[] = [row({ playerId: "fa", team: null, season: 2026, week: 1, passAttempts: 10 })];
    const volumes = computeTeamVolume(rows, params, SETTINGS);
    expect(volumes.size).toBe(0);
  });
});

describe("applyEnvironment", () => {
  const base: TeamVolume = { team: "AAA", passAttempts: 30, rushAttempts: 20, offensiveSnaps: 62 };

  it("leaves volume unchanged under the neutral effect", () => {
    const result = applyEnvironment(base, { volume: 1, scoring: 1, rushShift: 0 });
    expect(result).toEqual(base);
  });

  it("moves plays from passing to rushing by rushShift times total plays, before scaling", () => {
    const result = applyEnvironment(base, { volume: 1, scoring: 1, rushShift: 0.1 });
    // 0.1 * (30 + 20) = 5 plays move from pass to rush.
    expect(result.passAttempts).toBeCloseTo(25, 10);
    expect(result.rushAttempts).toBeCloseTo(25, 10);
  });

  it("scales every play count by the volume multiplier after the shift", () => {
    const result = applyEnvironment(base, { volume: 1.1, scoring: 1, rushShift: 0 });
    expect(result.passAttempts).toBeCloseTo(33, 10);
    expect(result.rushAttempts).toBeCloseTo(22, 10);
    expect(result.offensiveSnaps).toBeCloseTo(68.2, 10);
  });

  it("floors both attempt counts at 0 so an extreme shift can never go negative", () => {
    const smallBase: TeamVolume = { team: "AAA", passAttempts: 2, rushAttempts: 1, offensiveSnaps: 5 };

    // rushShift is normally clamped to +/- scriptMax by environmentEffect, but
    // applyEnvironment takes a plain EnvironmentEffect and must defend itself
    // even against a value that large, rather than trusting its caller.
    const negativeShift = applyEnvironment(smallBase, { volume: 1, scoring: 1, rushShift: -5 });
    expect(negativeShift.rushAttempts).toBe(0);
    expect(negativeShift.passAttempts).toBeGreaterThan(0);

    const positiveShift = applyEnvironment(smallBase, { volume: 1, scoring: 1, rushShift: 5 });
    expect(positiveShift.passAttempts).toBe(0);
    expect(positiveShift.rushAttempts).toBeGreaterThan(0);
  });

  it("floors offensive snaps at 0 under a negative volume multiplier", () => {
    const result = applyEnvironment(base, { volume: -1, scoring: 1, rushShift: 0 });
    expect(result.offensiveSnaps).toBe(0);
    expect(result.passAttempts).toBe(0);
    expect(result.rushAttempts).toBe(0);
  });
});
