import { describe, expect, it } from "vitest";
import { ringGeometry, ringRowSvg, ringRowWidth } from "./ring-geometry";
import { gaugeGeometry, gaugeSvg } from "./gauge-geometry";
import { ageChart } from "./age-geometry";

describe("ring geometry", () => {
  it("fills grade / 10 of the circle", () => {
    const r = ringGeometry(7, 64, 6);
    expect(r.r).toBe(29);
    expect(r.fraction).toBe(0.7);
    const [filled, rest] = r.dashArray.split(" ").map(Number);
    expect(filled / (filled + rest)).toBeCloseTo(0.7, 3);
  });

  it("draws no filled arc for a null grade", () => {
    const svg = ringRowSvg([null, 5], { size: 64, stroke: 6, gap: 8, trackColor: "#222", fromColor: "#A855F7", toColor: "#22D3EE" });
    expect(svg.match(/url\(#bp-ring\)/g)).toHaveLength(1);
    expect(ringRowWidth(6, 64, 8)).toBe(424);
  });
});

describe("gauge geometry", () => {
  it("spans a half circle and fills to the score", () => {
    const g = gaugeGeometry(50, { width: 300, stroke: 20 });
    // r = 140, so the center sits at y 150 and the stroke adds 10 below it.
    expect(g.height).toBe(160);
    expect(g.track.startsWith("M 10 150")).toBe(true);
    expect(g.fill.endsWith("150 10")).toBe(true);
    expect(gaugeGeometry(0, { width: 300, stroke: 20 }).fill).toBe("");
  });

  it("marks the two band boundaries", () => {
    const svg = gaugeSvg(80, { width: 300, stroke: 20, trackColor: "#222", fromColor: "#A855F7", toColor: "#22D3EE", tickColor: "#888" });
    expect(svg.match(/<line /g)).toHaveLength(2);
  });
});

describe("age geometry", () => {
  it("draws a pair per position on one scale, null as no bar", () => {
    const chart = ageChart(
      [
        { position: "QB", mine: null, league: 28.1, gap: null, count: 0 },
        { position: "RB", mine: 24, league: 25.5, gap: 1.5, count: 2 },
      ],
      { width: 400, labelWidth: 40, barHeight: 10, pairGap: 2, rowGap: 12 },
    );
    expect(chart.rows[0].mine).toBeNull();
    expect(chart.rows[1].league!.width).toBeGreaterThan(chart.rows[1].mine!.width);
    expect(chart.height).toBe(2 * 22 + 12);
    expect(chart.ticks.length).toBeGreaterThan(1);
  });
});
