import { describe, expect, it } from "vitest";
import type { LedgerWeek } from "@/lib/manager-ledger/types";
import { buildSeasonSeries, projectionAccuracy } from "./season";

function ledgerWeek(over: Partial<LedgerWeek> & { week: number }): LedgerWeek {
  return {
    officialPoints: 100,
    setPoints: 100,
    optimalPoints: 110,
    ungradedSlots: 0,
    pointsLeft: 10,
    opponentPoints: 95,
    outcome: "win",
    bestLineupOutcome: "win",
    biggestMiss: null,
    ...over,
  };
}

describe("buildSeasonSeries", () => {
  it("puts the best possible on the official basis, adding the deficit to the score", () => {
    const series = buildSeasonSeries({
      ledgerWeeks: [ledgerWeek({ week: 1, officialPoints: 130, pointsLeft: 12 })],
      projectedByWeek: new Map(),
      viewedWeek: 1,
    });
    expect(series.points[0].scored).toBe(130);
    expect(series.points[0].bestPossible).toBe(142);
  });

  it("takes efficiency from the gradable pair, not from the official one", () => {
    // An IDP league scores 40 points in slots the optimiser cannot touch. Using
    // official over (official plus pointsLeft) would read 140/150 = 93%; the
    // honest figure is the gradable 100/110 = 91%.
    const series = buildSeasonSeries({
      ledgerWeeks: [
        ledgerWeek({
          week: 1,
          officialPoints: 140,
          setPoints: 100,
          optimalPoints: 110,
          pointsLeft: 10,
          ungradedSlots: 3,
        }),
      ],
      projectedByWeek: new Map(),
      viewedWeek: 1,
    });
    expect(series.points[0].efficiency).toBeCloseTo(100 / 110, 4);
  });

  it("reports no efficiency for a row written before the ledger stored the pair", () => {
    const legacy = { week: 2, officialPoints: 120, pointsLeft: 8, opponentPoints: 100, outcome: "win", bestLineupOutcome: "win", biggestMiss: null } as unknown as LedgerWeek;
    const series = buildSeasonSeries({
      ledgerWeeks: [legacy],
      projectedByWeek: new Map(),
      viewedWeek: 2,
    });
    // Absent, never derived. A derived one would flatter an IDP league.
    expect(series.points[0].efficiency).toBeNull();
    expect(series.points[0].scored).toBe(120);
  });

  it("keeps a week that only one source knows about, from either side", () => {
    const series = buildSeasonSeries({
      ledgerWeeks: [ledgerWeek({ week: 1 })],
      projectedByWeek: new Map([[5, 118.4]]),
      viewedWeek: 5,
    });
    expect(series.points.map((p) => p.week)).toEqual([1, 5]);
    expect(series.points[1].scored).toBeNull();
    expect(series.points[1].projected).toBe(118.4);
    expect(series.settledCount).toBe(1);
    expect(series.projectedCount).toBe(1);
    expect(series.hasComparison).toBe(false);
  });

  it("marks the week the page is showing, and only that one", () => {
    const series = buildSeasonSeries({
      ledgerWeeks: [ledgerWeek({ week: 1 }), ledgerWeek({ week: 2 })],
      projectedByWeek: new Map([[3, 90]]),
      viewedWeek: 2,
    });
    expect(series.points.filter((p) => p.isViewed).map((p) => p.week)).toEqual([2]);
  });

  it("orders by week whatever order the sources arrived in", () => {
    const series = buildSeasonSeries({
      ledgerWeeks: [ledgerWeek({ week: 4 }), ledgerWeek({ week: 1 })],
      projectedByWeek: new Map([[3, 90], [2, 95]]),
      viewedWeek: 1,
    });
    expect(series.points.map((p) => p.week)).toEqual([1, 2, 3, 4]);
  });

  it("takes the ceiling from every series, so one axis fits all of them", () => {
    const series = buildSeasonSeries({
      ledgerWeeks: [ledgerWeek({ week: 1, officialPoints: 100, pointsLeft: 40 })],
      projectedByWeek: new Map([[2, 155]]),
      viewedWeek: 1,
    });
    expect(series.maxPoints).toBe(155);
  });
});

describe("projectionAccuracy", () => {
  it("reports nothing at all when no week has both halves", () => {
    const series = buildSeasonSeries({
      ledgerWeeks: [ledgerWeek({ week: 1 })],
      projectedByWeek: new Map(),
      viewedWeek: 1,
    });
    expect(projectionAccuracy(series.points)).toBeNull();
  });

  it("keeps the sign, because the direction is the finding", () => {
    // A model 10 out in both directions and one 10 low every week share an
    // absolute error and are completely different problems.
    const series = buildSeasonSeries({
      ledgerWeeks: [ledgerWeek({ week: 1, officialPoints: 110 }), ledgerWeek({ week: 2, officialPoints: 90 })],
      projectedByWeek: new Map([[1, 100], [2, 100]]),
      viewedWeek: 1,
    });
    const acc = projectionAccuracy(series.points);
    expect(acc?.weeks).toBe(2);
    expect(acc?.meanDiff).toBe(0);
    expect(acc?.meanAbsDiff).toBe(10);
    expect(acc?.beatWeeks).toBe(1);
  });

  it("counts a week that landed exactly on its number as not beaten", () => {
    const series = buildSeasonSeries({
      ledgerWeeks: [ledgerWeek({ week: 1, officialPoints: 100 })],
      projectedByWeek: new Map([[1, 100]]),
      viewedWeek: 1,
    });
    expect(projectionAccuracy(series.points)?.beatWeeks).toBe(0);
  });
});
