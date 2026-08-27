import { describe, expect, it } from "vitest";
import {
  buildChartGeometry,
  parseAxisMode,
  RANK_AXIS_CAP_MAX,
  type ChartGeometry,
} from "./chart-geometry";
import type { PositionCurve, PulsePosition, WarCurvePoint } from "./types";

const WIDTH = 640;
const HEIGHT = 360;
const PADDING = { t: 16, r: 16, b: 32, l: 40 };

/** Builds a PositionCurve from a position, its structural demand, and a plain
 * array of season WAR values, one per rank starting at 1. Keeps the fixtures
 * in each test readable as "this position, this many starters, these wins". */
function makeCurve(
  position: PulsePosition,
  demand: number,
  warValues: number[],
  opts: { warAtDemandOverride?: number | null } = {},
): PositionCurve {
  const curve: WarCurvePoint[] = warValues.map((war, i) => ({
    playerId: `${position}-${i + 1}`,
    sleeperId: `${position}-${i + 1}`,
    slug: `${position.toLowerCase()}-${i + 1}`,
    name: `${position} Player ${i + 1}`,
    team: null,
    injuryStatus: null,
    positionRank: i + 1,
    war,
    pointsAboveReplacement: Math.max(0, war * 10),
    projectedPointsPerWeek: 10 + war,
    replacementPointsPerWeek: 10,
    weeksProjected: 14,
  }));

  const demandPoint = curve.find((pt) => pt.positionRank === demand) ?? null;
  const warAtDemand =
    "warAtDemandOverride" in opts ? opts.warAtDemandOverride ?? null : (demandPoint?.war ?? null);

  return {
    position,
    structuralDemand: demand,
    replacementPoints: 10,
    avgSeatedPoints: 12,
    deficit: 2,
    shallowPool: curve.length < demand,
    warRank1: curve[0]?.war ?? null,
    warAtDemand: warAtDemand ?? null,
    cliffRank: null,
    curve,
    weeklyDiagnostics: [],
  };
}

function sixPositionCurves(): PositionCurve[] {
  return [
    makeCurve("QB", 2, seq(24, (r) => 0.7 - r * 0.028)),
    makeCurve("RB", 24, seq(48, (r) => 1.3 - r * 0.024)),
    makeCurve("WR", 30, seq(60, (r) => 1.1 - r * 0.016)),
    makeCurve("TE", 12, seq(20, (r) => 0.5 - r * 0.02)),
    makeCurve("K", 12, seq(18, (r) => 0.15 - r * 0.006)),
    makeCurve("DEF", 12, seq(16, (r) => 0.2 - r * 0.009)),
  ];
}

/** A ranks-1..n array of WAR values via a generator function. */
function seq(n: number, fn: (rank: number) => number): number[] {
  return Array.from({ length: n }, (_, i) => fn(i + 1));
}

/** Walks the whole geometry object and asserts every number in it is finite. */
function assertAllFinite(value: unknown, path = "root"): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), `${path} should be finite, got ${value}`).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertAllFinite(item, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertAllFinite(item, `${path}.${key}`);
    }
  }
}

function inBounds(geometry: ChartGeometry): void {
  const { plot } = geometry;
  const eps = 0.5;
  for (const s of geometry.series) {
    for (const p of s.points) {
      expect(p.x).toBeGreaterThanOrEqual(plot.left - eps);
      expect(p.x).toBeLessThanOrEqual(plot.right + eps);
      expect(p.y).toBeGreaterThanOrEqual(plot.top - eps);
      expect(p.y).toBeLessThanOrEqual(plot.bottom + eps);
    }
    if (s.markerAt) {
      expect(s.markerAt.x).toBeGreaterThanOrEqual(plot.left - eps);
      expect(s.markerAt.x).toBeLessThanOrEqual(plot.right + eps);
      expect(s.markerAt.y).toBeGreaterThanOrEqual(plot.top - eps);
      expect(s.markerAt.y).toBeLessThanOrEqual(plot.bottom + eps);
    }
  }
}

describe("parseAxisMode", () => {
  it("returns rank only for the literal string 'rank'", () => {
    expect(parseAxisMode("rank")).toBe("rank");
  });

  it("falls back to depth for anything else, silently", () => {
    expect(parseAxisMode("garbage")).toBe("depth");
    expect(parseAxisMode(undefined)).toBe("depth");
    expect(parseAxisMode(null)).toBe("depth");
    expect(parseAxisMode(["rank", "depth"])).toBe("depth");
    expect(parseAxisMode("")).toBe("depth");
  });
});

describe("buildChartGeometry: E2-1, same values across modes", () => {
  it("keeps every point's rank and war identical between depth and rank mode", () => {
    const curves = sixPositionCurves();
    const depth = buildChartGeometry({ curves, mode: "depth", width: WIDTH, height: HEIGHT, padding: PADDING });
    const rank = buildChartGeometry({ curves, mode: "rank", width: WIDTH, height: HEIGHT, padding: PADDING });

    expect(depth.series.length).toBe(rank.series.length);
    for (let i = 0; i < depth.series.length; i++) {
      const depthSeries = depth.series[i];
      const rankSeries = rank.series[i];
      expect(rankSeries.position).toBe(depthSeries.position);
      const depthValues = depthSeries.points.map((p) => ({ rank: p.rank, war: p.war, playerId: p.playerId }));
      const rankValues = rankSeries.points.map((p) => ({ rank: p.rank, war: p.war, playerId: p.playerId }));
      expect(rankValues).toEqual(depthValues);
    }
  });

  it("only the x coordinates differ between modes", () => {
    const curves = sixPositionCurves();
    const depth = buildChartGeometry({ curves, mode: "depth", width: WIDTH, height: HEIGHT, padding: PADDING });
    const rank = buildChartGeometry({ curves, mode: "rank", width: WIDTH, height: HEIGHT, padding: PADDING });

    for (let i = 0; i < depth.series.length; i++) {
      const dPts = depth.series[i].points;
      const rPts = rank.series[i].points;
      for (let j = 0; j < dPts.length; j++) {
        // y is the same scale in both modes, so it should match exactly.
        expect(rPts[j].y).toBeCloseTo(dPts[j].y, 6);
      }
    }
  });
});

describe("buildChartGeometry: the replacement marker", () => {
  it("sits at the depth axis's 1.0 tick in depth mode", () => {
    const curves = sixPositionCurves();
    const geometry = buildChartGeometry({ curves, mode: "depth", width: WIDTH, height: HEIGHT, padding: PADDING });
    const replacementTick = geometry.xTicks.find((t) => t.label === "Replacement level");
    expect(replacementTick).toBeDefined();
    for (const s of geometry.series) {
      expect(s.markerAt).not.toBeNull();
      expect(s.markerAt!.x).toBeCloseTo(replacementTick!.x, 6);
    }
  });

  it("sits at structuralDemand's rank position in rank mode, when it fits under the cap", () => {
    const curves = sixPositionCurves();
    const geometry = buildChartGeometry({ curves, mode: "rank", width: WIDTH, height: HEIGHT, padding: PADDING });
    for (const original of curves) {
      const s = geometry.series.find((series) => series.position === original.position)!;
      const demandPoint = s.points.find((p) => p.rank === original.structuralDemand);
      expect(demandPoint).toBeDefined();
      expect(s.markerAt!.x).toBeCloseTo(demandPoint!.x, 6);
      expect(s.truncated).toBe(false);
    }
  });

  it("carries the wins figure in the label when warAtDemand is present", () => {
    const curve = makeCurve("TE", 12, seq(20, (r) => 0.5 - r * 0.02));
    const geometry = buildChartGeometry({
      curves: [curve],
      mode: "depth",
      width: WIDTH,
      height: HEIGHT,
      padding: PADDING,
    });
    const label = geometry.series[0].markerAt!.label;
    expect(label).toBe(`TE12, ${curve.warAtDemand!.toFixed(2)} wins`);
  });

  it("drops the wins figure, never printing 0.00, when warAtDemand is null", () => {
    const curve = makeCurve("TE", 12, seq(20, (r) => 0.5 - r * 0.02), { warAtDemandOverride: null });
    const geometry = buildChartGeometry({
      curves: [curve],
      mode: "depth",
      width: WIDTH,
      height: HEIGHT,
      padding: PADDING,
    });
    const label = geometry.series[0].markerAt!.label;
    expect(label).toBe("TE12");
    expect(label).not.toContain("0.00");
  });
});

describe("buildChartGeometry: series length and truncation", () => {
  it("a series shorter than the cap ends where its data ends, no zero-fill tail", () => {
    // A thin kicker pool: 8 players plotted, well under any reasonable cap.
    // Demand stays at 2 (not 12) so this exercises "short series" in
    // isolation from the separate "demand exceeds the cap" case below.
    const curve = makeCurve("K", 2, seq(8, (r) => 0.15 - r * 0.01));
    const geometry = buildChartGeometry({
      curves: [curve],
      mode: "rank",
      width: WIDTH,
      height: HEIGHT,
      padding: PADDING,
    });
    const series = geometry.series[0];
    expect(series.points.length).toBe(curve.curve.length);
    expect(series.truncated).toBe(false);
    // The path has exactly one command per point: one M, the rest L.
    const commandCount = (series.d.match(/[ML]/g) ?? []).length;
    expect(commandCount).toBe(curve.curve.length);
    // No point carries a war of exactly 0 that wasn't in the source data.
    const lastPoint = series.points[series.points.length - 1];
    expect(lastPoint.war).toBeCloseTo(curve.curve[curve.curve.length - 1].war, 10);
  });

  it("clamps the marker and labels with a trailing plus when demand exceeds the rank cap", () => {
    // A very deep WR pool: 80 plotted players, so RANK_AXIS_CAP_MAX (60)
    // binds, and a structural demand of 100 sits well past it.
    const curve = makeCurve("WR", 100, seq(80, (r) => 1.0 - r * 0.01));
    const geometry = buildChartGeometry({
      curves: [curve],
      mode: "rank",
      width: WIDTH,
      height: HEIGHT,
      padding: PADDING,
    });
    const series = geometry.series[0];
    expect(series.truncated).toBe(true);
    expect(series.markerAt!.label).toBe("WR100+");
    expect(series.points.length).toBe(60);
    const lastPoint = series.points[series.points.length - 1];
    expect(series.markerAt!.x).toBeCloseTo(lastPoint.x, 6);
    assertAllFinite(geometry);
  });
});

describe("buildChartGeometry: skipping degenerate positions", () => {
  it("skips a position with structuralDemand 0 without producing NaN", () => {
    const curves = [...sixPositionCurves(), makeCurve("K", 0, [0.1, 0.05])];
    const geometry = buildChartGeometry({ curves, mode: "depth", width: WIDTH, height: HEIGHT, padding: PADDING });
    // Two K curves went in: one demand 12 (from sixPositionCurves) which
    // should survive, and one demand 0 which should not add a second entry.
    const kSeries = geometry.series.filter((s) => s.position === "K");
    expect(kSeries.length).toBe(1);
    assertAllFinite(geometry);
  });

  it("skips a position with an empty curve without producing NaN", () => {
    const empty = makeCurve("DEF", 12, []);
    const curves = [makeCurve("QB", 2, seq(10, (r) => 0.6 - r * 0.03)), empty];
    const geometry = buildChartGeometry({ curves, mode: "rank", width: WIDTH, height: HEIGHT, padding: PADDING });
    expect(geometry.series.some((s) => s.position === "DEF")).toBe(false);
    assertAllFinite(geometry);
  });

  it("produces finite geometry even when every curve is degenerate", () => {
    const curves = [makeCurve("QB", 0, []), makeCurve("RB", 12, [])];
    const geometry = buildChartGeometry({ curves, mode: "depth", width: WIDTH, height: HEIGHT, padding: PADDING });
    expect(geometry.series.length).toBe(0);
    assertAllFinite(geometry);
  });
});

describe("buildChartGeometry: negative WAR (clampBelowReplacement: false)", () => {
  it("produces a yMin below zero and keeps every point inside the plot", () => {
    const curve = makeCurve("QB", 2, [0.6, 0.3, -0.1, -0.4, -0.6]);
    const geometry = buildChartGeometry({
      curves: [curve],
      mode: "depth",
      width: WIDTH,
      height: HEIGHT,
      padding: PADDING,
    });
    expect(geometry.yMin).toBeLessThan(0);
    inBounds(geometry);
    assertAllFinite(geometry);
  });

  it("still reports 4 to 6 y ticks with a negative floor", () => {
    const curve = makeCurve("RB", 24, seq(30, (r) => 0.9 - r * 0.06));
    const geometry = buildChartGeometry({
      curves: [curve],
      mode: "depth",
      width: WIDTH,
      height: HEIGHT,
      padding: PADDING,
    });
    expect(geometry.yTicks.length).toBeGreaterThanOrEqual(4);
    expect(geometry.yTicks.length).toBeLessThanOrEqual(6);
  });
});

describe("buildChartGeometry: determinism", () => {
  it("two calls with the same input are deep-equal", () => {
    const curves = sixPositionCurves();
    const a = buildChartGeometry({ curves, mode: "rank", width: WIDTH, height: HEIGHT, padding: PADDING });
    const b = buildChartGeometry({ curves, mode: "rank", width: WIDTH, height: HEIGHT, padding: PADDING });
    expect(a).toEqual(b);
  });

  it("holds for depth mode too", () => {
    const curves = sixPositionCurves();
    const a = buildChartGeometry({ curves, mode: "depth", width: WIDTH, height: HEIGHT, padding: PADDING });
    const b = buildChartGeometry({ curves, mode: "depth", width: WIDTH, height: HEIGHT, padding: PADDING });
    expect(a).toEqual(b);
  });
});

describe("buildChartGeometry: points stay inside the plot rectangle", () => {
  const fixtures: Array<{ label: string; curves: PositionCurve[]; mode: "depth" | "rank" }> = [
    { label: "typical league, depth", curves: sixPositionCurves(), mode: "depth" },
    { label: "typical league, rank", curves: sixPositionCurves(), mode: "rank" },
    {
      label: "shallow pool at TE",
      curves: [makeCurve("TE", 12, seq(6, (r) => 0.3 - r * 0.04))],
      mode: "depth",
    },
    {
      label: "shallow pool at TE, rank mode",
      curves: [makeCurve("TE", 12, seq(6, (r) => 0.3 - r * 0.04))],
      mode: "rank",
    },
    {
      label: "single spiky QB curve",
      curves: [makeCurve("QB", 1, [2.4, 0.1, 0.05, 0.02])],
      mode: "depth",
    },
    {
      label: "very deep WR pool past the rank cap",
      curves: [makeCurve("WR", 45, seq(90, (r) => 1.2 - r * 0.012))],
      mode: "rank",
    },
  ];

  for (const { label, curves, mode } of fixtures) {
    it(`holds for: ${label}`, () => {
      const geometry = buildChartGeometry({ curves, mode, width: WIDTH, height: HEIGHT, padding: PADDING });
      inBounds(geometry);
      assertAllFinite(geometry);
    });
  }
});

describe("RANK_AXIS_CAP_MAX", () => {
  it("bounds the rank-mode domain at 60 regardless of a deeper pool", () => {
    const curve = makeCurve("WR", 20, seq(90, (r) => 1.0 - r * 0.01));
    const geometry = buildChartGeometry({
      curves: [curve],
      mode: "rank",
      width: WIDTH,
      height: HEIGHT,
      padding: PADDING,
    });
    const lastTick = geometry.xTicks[geometry.xTicks.length - 1];
    expect(lastTick.label).toBe(String(RANK_AXIS_CAP_MAX));
  });
});
