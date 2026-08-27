/**
 * The Positional WAR conversion, and a regression guard against the one
 * simplification that would quietly break it.
 */

import { describe, expect, it } from "vitest";
import { normalCdf } from "@/lib/power-pulse/math";
import {
  baselineMean,
  differenceSigma,
  evaluatedMean,
  pointsAboveReplacement,
  positionDeficit,
  seasonWar,
  weeklyWar,
  type WeeklyWarInput,
} from "./war";

/**
 * A tiny seeded generator, so the property tests below are reproducible. The
 * engine itself has no RNG; this exists only to sweep the input space.
 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("pointsAboveReplacement", () => {
  it("floors at zero when clamping", () => {
    expect(pointsAboveReplacement(16, 8, true)).toBe(8);
    expect(pointsAboveReplacement(5, 8, true)).toBe(0);
  });

  it("lets a below-replacement player go negative when not clamping", () => {
    expect(pointsAboveReplacement(5, 8, false)).toBe(-3);
  });
});

describe("the worked example from plan section 4.4.1", () => {
  // A 12-team league running [QB,RB,RB,WR,WR,WR,TE,FLEX,K,DEF], week 5.
  // Sum of seated points 1560.0 over 12 teams, sum of seated sigma^2 8640.0.
  const muRef = 1560 / 12; // 130.00
  const sigmaRef = Math.sqrt(8640 / 12); // sqrt(720) = 26.8328...
  const avgSeatedTe = 12.5;
  const replacementTe = 8;
  const projected = 16;

  const deficit = positionDeficit(avgSeatedTe, replacementTe);
  const par = pointsAboveReplacement(projected, replacementTe, true);

  it("reproduces the plan's arithmetic", () => {
    expect(muRef).toBeCloseTo(130, 10);
    expect(sigmaRef).toBeCloseTo(26.8328, 4);
    expect(differenceSigma(sigmaRef)).toBeCloseTo(37.9473, 4);
    expect(deficit).toBeCloseTo(4.5, 10);
    expect(par).toBeCloseTo(8, 10);
    expect(baselineMean(muRef, deficit)).toBeCloseTo(125.5, 10);
    expect(evaluatedMean(muRef, deficit, par)).toBeCloseTo(133.5, 10);
  });

  it("produces the plan's weekly WAR of 0.08395", () => {
    const war = weeklyWar({ muRef, sigmaRef, deficit, par });
    // The plan's tolerance is 1e-5 and its own figure carries intermediate
    // rounding: it works from sigmaD 37.94 rather than the exact 37.94733, and
    // from normalCdf values rounded to five places. Asserting through
    // toBeCloseTo(x, 5) would be a 5e-6 tolerance, tighter than the fixture it
    // is checking against, so the bound is written out.
    expect(Math.abs(war - 0.08395)).toBeLessThan(1e-5);
  });

  it("does not use the centered baseline", () => {
    // The double-counted form. If anyone simplifies weeklyWar back to this,
    // this test is what tells them why it is wrong: it describes a team holding
    // both a league-average tight end AND the evaluated one, in the same slot.
    const sigmaDiff = differenceSigma(sigmaRef);
    const doubleCounted = normalCdf(par / sigmaDiff) - 0.5;
    const correct = weeklyWar({ muRef, sigmaRef, deficit, par });
    expect(doubleCounted).not.toBeCloseTo(correct, 10);
    // The plan prints 0.08351 for this, from a z rounded to 0.21086. The exact
    // z is 0.2108189 and the exact figure is 0.083486. What the fixture is
    // really pinning is the gap: about half a percent low at these magnitudes,
    // because normalCdf is close to linear near zero.
    expect(doubleCounted).toBeCloseTo(0.083486, 6);
    expect((correct - doubleCounted) / correct).toBeCloseTo(0.0054, 3);
  });

  it("costs 16 percent in a low-variance league, which is where it stops being small", () => {
    const lowSigmaRef = 12;
    const sigmaDiff = differenceSigma(lowSigmaRef); // 16.97
    const correct = weeklyWar({ muRef: 130, sigmaRef: lowSigmaRef, deficit: 8, par: 20 });
    const doubleCounted = normalCdf(20 / sigmaDiff) - 0.5;
    expect(correct).toBeCloseTo(0.4415, 3);
    expect(doubleCounted).toBeCloseTo(0.3807, 3);
    expect((correct - doubleCounted) / correct).toBeGreaterThan(0.13);
  });
});

describe("the properties the model is built on", () => {
  it("gives exactly zero WAR at PAR zero, across every deficit from 0 to 30", () => {
    for (let deficit = 0; deficit <= 30; deficit += 0.5) {
      const war = weeklyWar({ muRef: 130, sigmaRef: 26, deficit, par: 0 });
      expect(Math.abs(war)).toBeLessThan(1e-12);
    }
  });

  it("is never negative for any non-negative PAR", () => {
    const rng = seeded(20260826);
    for (let i = 0; i < 500; i += 1) {
      const muRef = 60 + rng() * 140;
      const sigmaRef = 5 + rng() * 40;
      const deficit = rng() * 30;
      const par = rng() * 40;
      expect(weeklyWar({ muRef, sigmaRef, deficit, par })).toBeGreaterThanOrEqual(0);
    }
  });

  it("is strictly increasing in PAR, so raising a projection can never lower WAR", () => {
    const rng = seeded(7);
    for (let i = 0; i < 200; i += 1) {
      const base: WeeklyWarInput = {
        muRef: 60 + rng() * 140,
        sigmaRef: 5 + rng() * 40,
        deficit: rng() * 30,
        par: rng() * 20,
      };
      const bump = 0.01 + rng() * 5;
      const before = weeklyWar(base);
      const after = weeklyWar({ ...base, par: base.par + bump });
      expect(after).toBeGreaterThan(before);
    }
  });

  it("keeps evaluatedMean minus baselineMean exactly equal to PAR", () => {
    const rng = seeded(99);
    for (let i = 0; i < 500; i += 1) {
      const muRef = 60 + rng() * 140;
      const deficit = rng() * 30;
      const par = rng() * 40;
      expect(evaluatedMean(muRef, deficit, par) - baselineMean(muRef, deficit)).toBeCloseTo(par, 12);
    }
  });

  it("sets baselineMean to muRef minus the deficit", () => {
    const rng = seeded(4242);
    for (let i = 0; i < 200; i += 1) {
      const muRef = 60 + rng() * 140;
      const deficit = rng() * 30;
      expect(baselineMean(muRef, deficit)).toBeCloseTo(muRef - deficit, 12);
    }
  });

  it("sums weekly differences into the season figure", () => {
    const weeks: WeeklyWarInput[] = [
      { muRef: 128, sigmaRef: 25, deficit: 4, par: 6 },
      { muRef: 131, sigmaRef: 27, deficit: 5.5, par: 9.25 },
      { muRef: 119, sigmaRef: 22, deficit: 3.1, par: 0 },
      { muRef: 140, sigmaRef: 31, deficit: 7.4, par: 12.8 },
    ];
    const manual = weeks.reduce((sum, w) => sum + weeklyWar(w), 0);
    expect(Math.abs(seasonWar(weeks) - manual)).toBeLessThan(1e-9);
  });

  it("is deterministic: two runs on identical input are byte-identical", () => {
    const weeks: WeeklyWarInput[] = Array.from({ length: 14 }, (_, i) => ({
      muRef: 120 + i,
      sigmaRef: 24 + (i % 5),
      deficit: 3 + (i % 7) * 0.4,
      par: (i % 11) * 1.3,
    }));
    expect(seasonWar(weeks)).toBe(seasonWar(weeks));
    expect(JSON.stringify(weeks.map(weeklyWar))).toBe(JSON.stringify(weeks.map(weeklyWar)));
  });

  it("gives a player who never beats replacement exactly zero for the season", () => {
    const weeks: WeeklyWarInput[] = Array.from({ length: 12 }, (_, i) => ({
      muRef: 125 + i,
      sigmaRef: 26,
      deficit: 4 + i * 0.2,
      par: pointsAboveReplacement(5, 9 + i * 0.3, true),
    }));
    expect(seasonWar(weeks)).toBe(0);
  });
});

describe("clampBelowReplacement set false", () => {
  it("gives a below-replacement player negative WAR", () => {
    const par = pointsAboveReplacement(4, 9, false);
    expect(par).toBe(-5);
    expect(weeklyWar({ muRef: 130, sigmaRef: 26, deficit: 4.5, par })).toBeLessThan(0);
  });

  it("still returns zero at exactly replacement level", () => {
    const par = pointsAboveReplacement(9, 9, false);
    expect(Math.abs(weeklyWar({ muRef: 130, sigmaRef: 26, deficit: 4.5, par }))).toBeLessThan(1e-12);
  });
});

describe("degenerate inputs", () => {
  it("treats a zero-spread league as a step function, matching winProbability", () => {
    expect(weeklyWar({ muRef: 130, sigmaRef: 0, deficit: 4, par: 10 })).toBe(1);
    expect(weeklyWar({ muRef: 130, sigmaRef: 0, deficit: 4, par: 0 })).toBe(0);
    // Baseline exactly level with the league average is half a win, and adding
    // a point takes it to a whole one.
    expect(weeklyWar({ muRef: 130, sigmaRef: 0, deficit: 0, par: 1 })).toBe(0.5);
  });

  it("returns zero rather than NaN for a non-finite input", () => {
    expect(weeklyWar({ muRef: Number.NaN, sigmaRef: 26, deficit: 4, par: 8 })).toBe(0);
    expect(weeklyWar({ muRef: 130, sigmaRef: Number.NaN, deficit: 4, par: 8 })).toBe(0);
    expect(weeklyWar({ muRef: 130, sigmaRef: 26, deficit: 4, par: Number.NaN })).toBe(0);
  });

  it("never lets a deficit larger than the league average produce a negative baseline", () => {
    expect(baselineMean(10, 30)).toBe(0);
  });
});
