/**
 * lib/projections/adjust.ts, the opponent-adjustment iteration and the two
 * multiplier helpers built on top of it.
 *
 * The strong/weak schedule fixture below is the case the module exists for:
 * two defenses that allowed the exact same raw points, one having faced only
 * offenses that normally score well above league average, the other having
 * faced only offenses that normally score well below it. A working
 * adjustment must tell them apart even though the raw numbers cannot.
 */

import { describe, expect, it } from "vitest";
import { adjustForOpponents, clampMultiplier, shrinkMultiplier, type PositionGame } from "./adjust";

describe("adjustForOpponents", () => {
  it("returns an empty, zeroed result for no games rather than NaN", () => {
    const result = adjustForOpponents([]);
    expect(result.leagueAverage).toBe(0);
    expect(result.defense.size).toBe(0);
    expect(result.offense.size).toBe(0);
    expect(result.iterations).toBe(0);
  });

  it("leaves a single isolated game at its raw value", () => {
    const games: PositionGame[] = [{ defense: "A", offense: "B", week: 1, points: 12 }];
    const result = adjustForOpponents(games);

    expect(result.leagueAverage).toBe(12);
    const defenseA = result.defense.get("A");
    expect(defenseA).toBeDefined();
    expect(defenseA?.rawPerGame).toBe(12);
    expect(defenseA?.adjustedPerGame).toBe(12);
    expect(defenseA?.games).toBe(1);

    const offenseB = result.offense.get("B");
    expect(offenseB?.rawPerGame).toBe(12);
    expect(offenseB?.adjustedPerGame).toBe(12);
  });

  it("holds every rating at the league average in a fully symmetric league", () => {
    // Every team allows and produces exactly 10 points a game, against every
    // opponent, so there is no schedule bias for the adjustment to remove.
    const games: PositionGame[] = [
      { defense: "A", offense: "B", week: 1, points: 10 },
      { defense: "B", offense: "A", week: 1, points: 10 },
      { defense: "A", offense: "C", week: 2, points: 10 },
      { defense: "C", offense: "A", week: 2, points: 10 },
      { defense: "B", offense: "C", week: 3, points: 10 },
      { defense: "C", offense: "B", week: 3, points: 10 },
    ];
    const result = adjustForOpponents(games);

    expect(result.leagueAverage).toBe(10);
    for (const team of ["A", "B", "C"]) {
      const defense = result.defense.get(team);
      const offense = result.offense.get(team);
      expect(defense?.adjustedPerGame).toBe(10);
      expect(offense?.adjustedPerGame).toBe(10);
      // The multiplier a reader would see from this rating.
      expect((defense?.adjustedPerGame ?? 0) / result.leagueAverage).toBe(1);
    }
  });

  it("tells apart two defenses with identical raw allowance but opposite schedule strength", () => {
    // D1-D4 are ordinary defenses that establish each offense's true level:
    // S1/S2 normally score 15, W1/W2 normally score 5.
    // X faces only the strong offenses and holds them to 10.
    // Y faces only the weak offenses and allows them 10.
    // X and Y therefore have the identical raw allowance of 10 a game.
    const games: PositionGame[] = [
      { defense: "D1", offense: "S1", week: 1, points: 15 },
      { defense: "D2", offense: "S2", week: 1, points: 15 },
      { defense: "D3", offense: "W1", week: 1, points: 5 },
      { defense: "D4", offense: "W2", week: 1, points: 5 },
      { defense: "D1", offense: "W1", week: 2, points: 5 },
      { defense: "D2", offense: "W2", week: 2, points: 5 },
      { defense: "D3", offense: "S1", week: 2, points: 15 },
      { defense: "D4", offense: "S2", week: 2, points: 15 },
      { defense: "X", offense: "S1", week: 3, points: 10 },
      { defense: "X", offense: "S2", week: 4, points: 10 },
      { defense: "Y", offense: "W1", week: 3, points: 10 },
      { defense: "Y", offense: "W2", week: 4, points: 10 },
    ];
    const result = adjustForOpponents(games);

    const x = result.defense.get("X");
    const y = result.defense.get("Y");
    expect(x?.rawPerGame).toBe(10);
    expect(y?.rawPerGame).toBe(10);
    // X suppressed offenses that normally outscore this; the adjustment must
    // read that as a stingier defense than its raw number says.
    // Y allowed offenses well above their normal output; the adjustment must
    // read that as a more generous defense than its raw number says.
    expect(x?.adjustedPerGame).toBeLessThan(result.leagueAverage);
    expect(y?.adjustedPerGame).toBeGreaterThan(result.leagueAverage);
    expect(x?.adjustedPerGame).toBeLessThan(y?.adjustedPerGame ?? 0);
  });

  it("moves only a small amount between 4 and 8 iterations, having already mostly converged", () => {
    const games: PositionGame[] = [
      { defense: "D1", offense: "S1", week: 1, points: 15 },
      { defense: "D2", offense: "S2", week: 1, points: 15 },
      { defense: "D3", offense: "W1", week: 1, points: 5 },
      { defense: "D4", offense: "W2", week: 1, points: 5 },
      { defense: "D1", offense: "W1", week: 2, points: 5 },
      { defense: "D2", offense: "W2", week: 2, points: 5 },
      { defense: "D3", offense: "S1", week: 2, points: 15 },
      { defense: "D4", offense: "S2", week: 2, points: 15 },
      { defense: "X", offense: "S1", week: 3, points: 10 },
      { defense: "X", offense: "S2", week: 4, points: 10 },
      { defense: "Y", offense: "W1", week: 3, points: 10 },
      { defense: "Y", offense: "W2", week: 4, points: 10 },
    ];
    const fourPasses = adjustForOpponents(games, { iterations: 4 });
    const eightPasses = adjustForOpponents(games, { iterations: 8 });

    const deltaX = Math.abs(
      (eightPasses.defense.get("X")?.adjustedPerGame ?? 0) - (fourPasses.defense.get("X")?.adjustedPerGame ?? 0),
    );
    const deltaY = Math.abs(
      (eightPasses.defense.get("Y")?.adjustedPerGame ?? 0) - (fourPasses.defense.get("Y")?.adjustedPerGame ?? 0),
    );

    // Still moving, so the two passes are not identical
    expect(deltaX).toBeGreaterThan(0);
    expect(deltaY).toBeGreaterThan(0);
    // But moving by a fraction of a point, not by points, which is what
    // "already converged after 4 passes" means in practice.
    expect(deltaX).toBeLessThan(1);
    expect(deltaY).toBeLessThan(1);
  });

  it("computes the new defense pass from the old offense pass, then the new offense pass from the just-updated defense", () => {
    // A minimal 2x2 league, small enough to check by hand. D1 and D2 each
    // face O1 once and O2 once.
    const games: PositionGame[] = [
      { defense: "D1", offense: "O1", week: 1, points: 8 },
      { defense: "D1", offense: "O2", week: 2, points: 12 },
      { defense: "D2", offense: "O1", week: 1, points: 6 },
      { defense: "D2", offense: "O2", week: 2, points: 14 },
    ];
    const result = adjustForOpponents(games, { iterations: 1 });

    const L = 10; // mean(8, 12, 6, 14)
    const rawO1 = 7; // mean(8, 6)
    const rawO2 = 13; // mean(12, 14)

    // Correct order: the new defense values are read off the RAW offense
    // means, since this is pass 1.
    const expectedD1 = ((8 * L) / rawO1 + (12 * L) / rawO2) / 2;
    const expectedD2 = ((6 * L) / rawO1 + (14 * L) / rawO2) / 2;

    // Then the new offense values are read off those JUST-COMPUTED defense
    // values, not off a defense seed from before this pass.
    const expectedO1 = ((8 * L) / expectedD1 + (6 * L) / expectedD2) / 2;
    const expectedO2 = ((12 * L) / expectedD1 + (14 * L) / expectedD2) / 2;

    expect(result.defense.get("D1")?.adjustedPerGame).toBeCloseTo(expectedD1, 8);
    expect(result.defense.get("D2")?.adjustedPerGame).toBeCloseTo(expectedD2, 8);
    expect(result.offense.get("O1")?.adjustedPerGame).toBeCloseTo(expectedO1, 8);
    expect(result.offense.get("O2")?.adjustedPerGame).toBeCloseTo(expectedO2, 8);

    // The wrong order (offense read off the DEFENSE SEED rather than the new
    // defense values) would have left O1 and O2 at their raw means. Confirm
    // the actual result is not that, so a regression that swaps the order
    // fails this test rather than passing it by accident.
    expect(result.offense.get("O1")?.adjustedPerGame).not.toBeCloseTo(rawO1, 4);
    expect(result.offense.get("O2")?.adjustedPerGame).not.toBeCloseTo(rawO2, 4);
  });

  it("falls back to raw points for a game whose opponent rating is a non-positive divisor", () => {
    // "Neg" is a corrupted offense with a single negative-points game, which
    // seeds its rating at -5. Any defense that faced it must not divide by
    // that -5; it must fall back to the game's own raw points instead, so the
    // corruption stays contained to the one team it started on.
    const games: PositionGame[] = [
      { defense: "A", offense: "Neg", week: 1, points: -5 },
      { defense: "B", offense: "D", week: 1, points: 8 },
    ];
    const result = adjustForOpponents(games);

    for (const rating of [...result.defense.values(), ...result.offense.values()]) {
      expect(Number.isFinite(rating.rawPerGame)).toBe(true);
      expect(Number.isFinite(rating.adjustedPerGame)).toBe(true);
    }
    // A's only game divided by an unusable divisor, so it fell back to its
    // raw value rather than blowing up or contaminating B.
    expect(result.defense.get("A")?.adjustedPerGame).toBe(-5);
    expect(result.defense.get("A")?.rawPerGame).toBe(-5);
  });

  it("short-circuits to raw ratings, unadjusted, when the league average is zero", () => {
    const games: PositionGame[] = [
      { defense: "A", offense: "B", week: 1, points: 0 },
      { defense: "C", offense: "D", week: 1, points: 0 },
    ];
    const result = adjustForOpponents(games);

    expect(result.leagueAverage).toBe(0);
    expect(result.iterations).toBe(0);
    for (const rating of [...result.defense.values(), ...result.offense.values()]) {
      expect(rating.adjustedPerGame).toBe(rating.rawPerGame);
    }
  });

  it("short-circuits to raw ratings, unadjusted, when the league average is negative", () => {
    const games: PositionGame[] = [{ defense: "A", offense: "B", week: 1, points: -3 }];
    const result = adjustForOpponents(games);

    expect(result.leagueAverage).toBe(-3);
    expect(result.iterations).toBe(0);
    expect(result.defense.get("A")?.adjustedPerGame).toBe(-3);
    expect(result.defense.get("A")?.rawPerGame).toBe(-3);
  });
});

describe("clampMultiplier", () => {
  it("passes a value already inside the band through unchanged", () => {
    expect(clampMultiplier(1.05, 0.8, 1.25)).toBe(1.05);
  });

  it("clamps to the floor and the ceiling", () => {
    expect(clampMultiplier(0.2, 0.8, 1.25)).toBe(0.8);
    expect(clampMultiplier(5, 0.8, 1.25)).toBe(1.25);
  });
});

describe("shrinkMultiplier", () => {
  it("returns exactly 1 at zero reliability, no matter how large the adjustment or the sample", () => {
    const result = shrinkMultiplier({
      adjustedMultiplier: 1.6,
      gamesSampled: 200,
      positionReliability: 0,
      priorGames: 4,
      min: 0.5,
      max: 2,
    });
    expect(result).toBe(1);
  });

  it("returns exactly 1 when neither games sampled nor the prior carry any weight", () => {
    const result = shrinkMultiplier({
      adjustedMultiplier: 1.6,
      gamesSampled: 0,
      positionReliability: 1,
      priorGames: 0,
      min: 0.5,
      max: 2,
    });
    expect(result).toBe(1);
  });

  it("approaches the full adjusted multiplier at reliability 1 and a sample far larger than the prior", () => {
    const result = shrinkMultiplier({
      adjustedMultiplier: 1.1,
      gamesSampled: 10_000,
      positionReliability: 1,
      priorGames: 6,
      min: 0.5,
      max: 2,
    });
    expect(result).toBeCloseTo(1.1, 3);
  });

  it("still clamps a full-confidence result that lands outside the band", () => {
    const result = shrinkMultiplier({
      adjustedMultiplier: 1.6,
      gamesSampled: 10_000,
      positionReliability: 1,
      priorGames: 6,
      min: 0.8,
      max: 1.25,
    });
    expect(result).toBe(1.25);
  });

  it("shrinks harder with fewer games relative to the prior", () => {
    const fewGames = shrinkMultiplier({
      adjustedMultiplier: 1.5,
      gamesSampled: 2,
      positionReliability: 1,
      priorGames: 8,
      min: 0.5,
      max: 2,
    });
    const manyGames = shrinkMultiplier({
      adjustedMultiplier: 1.5,
      gamesSampled: 32,
      positionReliability: 1,
      priorGames: 8,
      min: 0.5,
      max: 2,
    });
    expect(fewGames).toBeGreaterThan(1);
    expect(fewGames).toBeLessThan(manyGames);
    expect(manyGames).toBeLessThan(1.5);
  });

  it("matches the formula exactly at a known sample split", () => {
    // gamesSampled == priorGames, so kSample is exactly 0.5.
    const result = shrinkMultiplier({
      adjustedMultiplier: 1.4,
      gamesSampled: 8,
      positionReliability: 0.5,
      priorGames: 8,
      min: 0,
      max: 2,
    });
    // 1 + 0.5 * 0.5 * (1.4 - 1) = 1.1
    expect(result).toBeCloseTo(1.1, 10);
  });

  it("clamps out-of-range reliability into 0 to 1 before applying it", () => {
    const overOne = shrinkMultiplier({
      adjustedMultiplier: 1.4,
      gamesSampled: 100,
      positionReliability: 5,
      priorGames: 4,
      min: 0,
      max: 2,
    });
    const atOne = shrinkMultiplier({
      adjustedMultiplier: 1.4,
      gamesSampled: 100,
      positionReliability: 1,
      priorGames: 4,
      min: 0,
      max: 2,
    });
    expect(overOne).toBe(atOne);
  });

  it("floors a negative games-sampled count at 0", () => {
    const result = shrinkMultiplier({
      adjustedMultiplier: 1.4,
      gamesSampled: -5,
      positionReliability: 1,
      priorGames: 4,
      min: 0,
      max: 2,
    });
    expect(result).toBe(1);
  });
});

/**
 * Review finding, pinned. Math.min(max, Math.max(min, NaN)) is NaN, so an
 * unguarded clamp would write a NaN straight into
 * nfl_defense_vs_position.shrunk_multiplier, and every projection facing that
 * defense would then be multiplied by it.
 */
describe("clampMultiplier, non-finite inputs", () => {
  it("returns the floor for NaN rather than propagating it", () => {
    expect(clampMultiplier(Number.NaN, 0.8, 1.25)).toBe(0.8);
  });

  it("returns the floor for Infinity in either direction", () => {
    expect(clampMultiplier(Number.POSITIVE_INFINITY, 0.8, 1.25)).toBe(0.8);
    expect(clampMultiplier(Number.NEGATIVE_INFINITY, 0.8, 1.25)).toBe(0.8);
  });

  it("still clamps ordinary values the way it always did", () => {
    expect(clampMultiplier(1.9, 0.8, 1.25)).toBe(1.25);
    expect(clampMultiplier(0.1, 0.8, 1.25)).toBe(0.8);
    expect(clampMultiplier(1.02, 0.8, 1.25)).toBe(1.02);
  });
});
