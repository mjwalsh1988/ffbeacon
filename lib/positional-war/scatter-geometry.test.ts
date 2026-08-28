/**
 * Tests for the trade value against Positional WAR scatterplot geometry.
 *
 * The load-bearing properties: a player with no published value is never
 * plotted at zero, the trend line only appears when it can be explained, and
 * every dot lands inside the plot rectangle whatever the data does.
 */

import { describe, expect, it } from "vitest";
import { buildScatterGeometry, describeTrend, MIN_TREND_POINTS } from "./scatter-geometry";
import type { WarTableRow } from "./table";
import type { PulsePosition } from "@/lib/power-pulse/types";

const WIDTH = 640;
const HEIGHT = 360;
const PADDING = { t: 14, r: 18, b: 34, l: 42 };

function row(
  i: number,
  war: number,
  tradeValue: number | null,
  position: PulsePosition = "RB",
): WarTableRow {
  return {
    playerId: `p-${i}`,
    sleeperId: `s-${i}`,
    slug: `p-${i}`,
    name: `Player ${i}`,
    team: "BUF",
    injuryStatus: null,
    positionRank: i,
    war,
    pointsAboveReplacement: war * 100,
    projectedPointsPerWeek: 10 + war,
    replacementPointsPerWeek: 10,
    weeksProjected: 13,
    position,
    tier: "starter",
    warPerWeek: war / 13,
    owner: null,
    isYours: false,
    tradeValue,
  };
}

/** n rows on a perfect line: war = value / 5000. */
function linear(n: number): WarTableRow[] {
  return Array.from({ length: n }, (_, i) => row(i + 1, ((i + 1) * 250) / 5000, (i + 1) * 250));
}

function build(rows: WarTableRow[]) {
  return buildScatterGeometry({ rows, width: WIDTH, height: HEIGHT, padding: PADDING });
}

describe("plotting", () => {
  it("leaves a player with no published value off the plot and counts him", () => {
    const geometry = build([row(1, 1.2, 4000), row(2, 0.8, null), row(3, 0.4, null)]);
    expect(geometry.points.length).toBe(1);
    expect(geometry.omittedCount).toBe(2);
    // And never at x = 0, which is what a zero would have produced.
    expect(geometry.points.every((p) => p.tradeValue > 0)).toBe(true);
  });

  it("keeps every dot inside the plot rectangle", () => {
    const geometry = build(linear(40));
    for (const point of geometry.points) {
      expect(point.x).toBeGreaterThanOrEqual(geometry.plot.left - 1e-6);
      expect(point.x).toBeLessThanOrEqual(geometry.plot.right + 1e-6);
      expect(point.y).toBeGreaterThanOrEqual(geometry.plot.top - 1e-6);
      expect(point.y).toBeLessThanOrEqual(geometry.plot.bottom + 1e-6);
    }
  });

  it("produces finite coordinates when every player shares one value", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(i + 1, 0.5, 3000));
    const geometry = build(rows);
    for (const point of geometry.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it("returns an empty plot rather than throwing when nothing has a value", () => {
    const geometry = build([row(1, 1, null)]);
    expect(geometry.points).toEqual([]);
    expect(geometry.trend).toBeNull();
    expect(geometry.omittedCount).toBe(1);
  });

  it("marks where zero wins sits", () => {
    const geometry = build(linear(30));
    expect(geometry.zeroY).not.toBeNull();
  });

  it("carries the raw figures alongside the coordinates, so a readout never inverts a scale", () => {
    const geometry = build([row(1, 1.25, 7000)]);
    expect(geometry.points[0].war).toBe(1.25);
    expect(geometry.points[0].tradeValue).toBe(7000);
  });

  it("labels values in the thousands compactly", () => {
    const geometry = build(linear(40));
    expect(geometry.xTicks.some((t) => t.label.endsWith("k"))).toBe(true);
  });
});

describe("the trend line", () => {
  it("is not drawn below the minimum sample", () => {
    expect(build(linear(MIN_TREND_POINTS - 1)).trend).toBeNull();
  });

  it("is drawn at the minimum sample", () => {
    expect(build(linear(MIN_TREND_POINTS)).trend).not.toBeNull();
  });

  it("recovers a perfect linear relationship exactly", () => {
    const geometry = build(linear(30));
    expect(geometry.trend!.slope).toBeCloseTo(1 / 5000, 10);
    expect(geometry.trend!.r2).toBeCloseTo(1, 10);
    expect(geometry.trend!.n).toBe(30);
  });

  it("is not drawn when every player shares one trade value", () => {
    // A vertical cloud has no slope to fit; the divisor is zero.
    const rows = Array.from({ length: 30 }, (_, i) => row(i + 1, i * 0.05, 3000));
    expect(build(rows).trend).toBeNull();
  });

  it("reports zero explained spread rather than a perfect fit when every WAR is identical", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i + 1, 0.5, (i + 1) * 200));
    expect(build(rows).trend!.r2).toBe(0);
  });

  it("counts only the plotted players, not the ones with no value", () => {
    const rows = [...linear(25), row(99, 1.5, null)];
    expect(build(rows).trend!.n).toBe(25);
  });
});

describe("describeTrend", () => {
  it("says nothing at all when there is no line", () => {
    expect(describeTrend(null)).toBeNull();
  });

  it("names the sample size and the explained spread", () => {
    const sentence = describeTrend(build(linear(30)).trend)!;
    expect(sentence).toContain("30 players");
    expect(sentence).toContain("100%");
  });

  it("declines to claim a direction when the fit explains almost nothing", () => {
    const weak = { d: "", slope: 0.00001, intercept: 0.4, r2: 0.03, n: 40 };
    const sentence = describeTrend(weak)!;
    expect(sentence).toContain("not moving together");
    expect(sentence).not.toContain("rises with");
  });

  it("never claims a forecast", () => {
    const sentence = describeTrend(build(linear(30)).trend)!;
    expect(sentence.toLowerCase()).not.toContain("predict");
    expect(sentence).toContain("not a forecast");
  });
});
