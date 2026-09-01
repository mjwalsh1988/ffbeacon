/**
 * The two pure pieces of the reliability multiplier: the positional baseline
 * and the centered, shrunk multiplier read off it.
 *
 * These exist as their own functions, and their own tests, because the number
 * they produce is applied to EVERY projection in Power Pulse, Positional WAR,
 * the FAAB calculator and the draft board. It was wrong in a way that looked
 * right for months: it carried the source's per-position bias against the
 * projection as if that bias were a property of the individual player, which
 * marked the whole quarterback pool down about 5% and the whole tight end pool
 * up about 3%.
 */

import { describe, expect, it } from "vitest";
import {
  centeredShrunkMultiplier,
  positionBaselineRatio,
} from "./calculate-projection-accuracy";

/** One graded player's ratio accumulator, as the calc builds it. */
function player(meanRatio: number, weight: number) {
  return { ratioSum: meanRatio * weight, ratioWeight: weight };
}

/** A pool of `count` identical players, enough to clear the minimum. */
function pool(meanRatio: number, weight: number, count: number) {
  return Array.from({ length: count }, () => player(meanRatio, weight));
}

describe("positionBaselineRatio", () => {
  it("is the weighted mean ratio across the pool", () => {
    const entries = [player(0.8, 10), player(1.0, 10), player(1.2, 10)];
    // Only 3 players, so pass a minimum it can clear.
    expect(positionBaselineRatio(entries, 3)).toBeCloseTo(1.0, 10);
  });

  it("weights by graded weeks, not by player, so a two-game sample cannot move it", () => {
    // Twelve steady players at 0.9, plus one two-game fluke at 3.0.
    const entries = [...pool(0.9, 12, 12), player(3.0, 2)];
    const baseline = positionBaselineRatio(entries)!;
    // Player-weighted this would be (12 * 0.9 + 3.0) / 13 = 1.062.
    // Week-weighted it is (12*12*0.9 + 2*3.0) / (144 + 2) = 0.929.
    expect(baseline).toBeCloseTo(0.9288, 3);
    expect(baseline).toBeLessThan(1.0);
  });

  it("returns null when the pool is thinner than the minimum", () => {
    expect(positionBaselineRatio(pool(0.85, 10, 11))).toBeNull();
    expect(positionBaselineRatio(pool(0.85, 10, 12))).not.toBeNull();
  });

  it("ignores players who contributed no gradeable ratio at all", () => {
    // Eleven real players plus five who never cleared MIN_PROJECTION_FOR_RATIO.
    // Sixteen entries, but only eleven graded, so still under the minimum.
    const entries = [...pool(0.9, 10, 11), ...pool(0, 0, 5)];
    expect(positionBaselineRatio(entries)).toBeNull();
  });

  it("returns null rather than a zero or an infinity when the pool grades to nothing", () => {
    expect(positionBaselineRatio(pool(0, 0, 40))).toBeNull();
    expect(positionBaselineRatio(pool(0, 10, 40))).toBeNull();
  });
});

describe("centeredShrunkMultiplier", () => {
  const bounds = { priorGames: 60, minMultiplier: 0.95, maxMultiplier: 1.05 };

  it("gives exactly 1.0 to a player who is exactly average for his position", () => {
    const result = centeredShrunkMultiplier({
      meanRatio: 0.83,
      ratioWeight: 12,
      baseline: 0.83,
      ...bounds,
    });
    expect(result).toBeCloseTo(1.0, 10);
  });

  it("gives the SAME answer to two equally-average players at positions the source treats differently", () => {
    // This is the whole fix. A quarterback pool that grades 0.83 against the
    // projection and a tight end pool that grades 1.03 are describing the
    // source, not the players, and an average member of either is average.
    const qb = centeredShrunkMultiplier({
      meanRatio: 0.83,
      ratioWeight: 12,
      baseline: 0.83,
      ...bounds,
    });
    const te = centeredShrunkMultiplier({
      meanRatio: 1.03,
      ratioWeight: 12,
      baseline: 1.03,
      ...bounds,
    });
    expect(qb).toBe(te);

    // Uncentered, the same two players came out 24% apart, which is the bug.
    const qbRaw = centeredShrunkMultiplier({
      meanRatio: 0.83,
      ratioWeight: 12,
      baseline: null,
      priorGames: 10,
      minMultiplier: 0.85,
      maxMultiplier: 1.15,
    })!;
    const teRaw = centeredShrunkMultiplier({
      meanRatio: 1.03,
      ratioWeight: 12,
      baseline: null,
      priorGames: 10,
      minMultiplier: 0.85,
      maxMultiplier: 1.15,
    })!;
    expect(teRaw - qbRaw).toBeGreaterThan(0.1);
  });

  it("still separates players WITHIN a position", () => {
    const better = centeredShrunkMultiplier({
      meanRatio: 1.0,
      ratioWeight: 12,
      baseline: 0.83,
      ...bounds,
    })!;
    const worse = centeredShrunkMultiplier({
      meanRatio: 0.7,
      ratioWeight: 12,
      baseline: 0.83,
      ...bounds,
    })!;
    expect(better).toBeGreaterThan(1);
    expect(worse).toBeLessThan(1);
  });

  it("shrinks toward 1.0 with sample size", () => {
    const thin = centeredShrunkMultiplier({
      meanRatio: 1.5,
      ratioWeight: 2,
      baseline: 1,
      ...bounds,
    })!;
    const thick = centeredShrunkMultiplier({
      meanRatio: 1.5,
      ratioWeight: 30,
      baseline: 1,
      ...bounds,
    })!;
    expect(thick).toBeGreaterThan(thin);
    expect(thin).toBeLessThan(1.05);
  });

  it("cannot move a projection more than the clamp allows, however extreme the ratio", () => {
    // Malik Willis graded 1.886 off a two-game sample and Jayden Daniels 0.672.
    // Under the old settings those became 1.073 and 0.886, a 19% gap applied to
    // two quarterbacks whose projections are four points apart.
    const hot = centeredShrunkMultiplier({
      meanRatio: 3,
      ratioWeight: 200,
      baseline: 0.83,
      ...bounds,
    });
    const cold = centeredShrunkMultiplier({
      meanRatio: 0.01,
      ratioWeight: 200,
      baseline: 0.83,
      ...bounds,
    });
    expect(hot).toBe(1.05);
    expect(cold).toBe(0.95);
  });

  it("falls back to the raw ratio when there is no baseline, rather than to neutral", () => {
    // A thin pool means we cannot separate the player's part from his
    // position's. We still know his own figure, so we use it.
    const withoutBaseline = centeredShrunkMultiplier({
      meanRatio: 1.4,
      ratioWeight: 12,
      baseline: null,
      ...bounds,
    })!;
    expect(withoutBaseline).toBeGreaterThan(1);
  });

  it("is null for a player with no gradeable ratio, never a fabricated 1.0", () => {
    expect(
      centeredShrunkMultiplier({ meanRatio: null, ratioWeight: 0, baseline: 0.9, ...bounds }),
    ).toBeNull();
  });

  it("does not divide by zero when an admin sets priorGames to zero", () => {
    const result = centeredShrunkMultiplier({
      meanRatio: 1,
      ratioWeight: 0,
      baseline: 1,
      priorGames: 0,
      minMultiplier: 0.95,
      maxMultiplier: 1.05,
    });
    expect(result).toBe(1);
  });
});
