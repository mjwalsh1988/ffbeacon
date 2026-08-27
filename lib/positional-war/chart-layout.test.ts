/**
 * Coverage for the chart's coordinate-space choice and its axis-label fitting.
 *
 * The thing worth pinning here is a RATIO, not a pixel count: what matters is
 * how big an axis label ends up on the reader's screen after the browser has
 * scaled the viewBox into the container. That is the number that was 4.5 CSS
 * px on a phone and the reason this module exists.
 */

import { describe, expect, it } from "vitest";
import {
  DESKTOP_BOX,
  NARROW_BREAKPOINT_PX,
  WIDTH_QUANTUM_PX,
  estimateLabelWidth,
  fitAxisLabels,
  narrowBoxFor,
  pickChartBox,
  quantizeChartWidth,
  type AxisTick,
} from "./chart-layout";

/** What an axis label measures on screen once the browser scales the viewBox. */
function renderedLabelPx(box: { width: number; fontSize: number }, containerPx: number): number {
  return box.fontSize * (containerPx / box.width);
}

describe("pickChartBox", () => {
  it("keeps the desktop box on a wide container, unchanged from before", () => {
    expect(pickChartBox(900)).toBe(DESKTOP_BOX);
    expect(pickChartBox(NARROW_BREAKPOINT_PX)).toBe(DESKTOP_BOX);
    expect(NARROW_BREAKPOINT_PX).toBe(DESKTOP_BOX.width);
    expect(DESKTOP_BOX.width).toBe(640);
    expect(DESKTOP_BOX.height).toBe(360);
    expect(DESKTOP_BOX.padding).toEqual({ t: 16, r: 16, b: 34, l: 42 });
  });

  it("resolves an unmeasured container to the desktop box, so hydration matches", () => {
    // The server has no container to measure and neither does the first client
    // paint. Both must produce the same markup or React reconciles a chart.
    expect(pickChartBox(null)).toBe(DESKTOP_BOX);
  });

  it("switches to a narrow box below the breakpoint, sized to the container", () => {
    expect(pickChartBox(320).width).toBe(320);
    expect(pickChartBox(260).width).toBe(260);
    expect(pickChartBox(NARROW_BREAKPOINT_PX - 20).width).toBe(NARROW_BREAKPOINT_PX - 20);
    expect(pickChartBox(NARROW_BREAKPOINT_PX - 20)).not.toBe(DESKTOP_BOX);
  });

  it("clamps the narrow box rather than following a container to either extreme", () => {
    expect(narrowBoxFor(40).width).toBe(200);
    expect(narrowBoxFor(5000).width).toBe(NARROW_BREAKPOINT_PX);
  });
});

describe("quantizeChartWidth", () => {
  it("rounds DOWN to the step the box is chosen on", () => {
    // Down, never to nearest: the coordinate space must never end up wider
    // than the container, or the type shrinks again. A 630px container that
    // rounded up to 640 would cross the breakpoint and take the wide box.
    expect(quantizeChartWidth(321)).toBe(320);
    expect(quantizeChartWidth(339)).toBe(320);
    expect(quantizeChartWidth(630)).toBe(620);
    expect(quantizeChartWidth(640)).toBe(640);
    expect(WIDTH_QUANTUM_PX).toBe(20);
  });

  it("never picks a coordinate space wider than the container", () => {
    for (let containerPx = 200; containerPx <= 1400; containerPx += 1) {
      const box = pickChartBox(quantizeChartWidth(containerPx));
      expect(box.width).toBeLessThanOrEqual(containerPx);
    }
  });

  it("passes null and nonsense through as unmeasured", () => {
    expect(quantizeChartWidth(null)).toBeNull();
    expect(quantizeChartWidth(0)).toBeNull();
    expect(quantizeChartWidth(Number.NaN)).toBeNull();
  });
});

describe("the readability the boxes exist to buy", () => {
  it("an axis label on a 320px phone was under 5 CSS px and is now near 10", () => {
    // The measurement that made this a defect rather than a hypothetical.
    expect(renderedLabelPx(DESKTOP_BOX, 320)).toBeLessThan(5);
    // And on the container a 320px viewport actually leaves the chart.
    expect(renderedLabelPx(DESKTOP_BOX, 224)).toBeLessThan(3.5);
    expect(renderedLabelPx(pickChartBox(320), 320)).toBeGreaterThanOrEqual(10);
  });

  it("holds at every container width a phone can produce, quantization included", () => {
    // From the narrowest container the layout can actually produce (a 320px
    // viewport, less the page gutter, the Panel body and the ChartFigure, is
    // 224 CSS px) up to the breakpoint, stepped by one pixel and quantized the
    // way the component quantizes it, so the rounding error is inside the
    // assertion rather than assumed away.
    for (let containerPx = 200; containerPx <= 1400; containerPx += 1) {
      const box = pickChartBox(quantizeChartWidth(containerPx));
      expect(renderedLabelPx(box, containerPx)).toBeGreaterThanOrEqual(9);
    }
  });

  it("the narrow box is taller than it is wide, never fewer series", () => {
    // docs/league-pulse-positional-war-plan.md: if six curves are unreadable
    // below the breakpoint the fallback is a taller aspect ratio, never
    // dropping a position. Nothing in this module can drop a series; it has no
    // access to one.
    // Taller than wide across every container a phone produces. The chart
    // gets its viewport less 96px of padding, so 340 here is a 436px viewport,
    // wider than any phone the site sees. Past that the ratio keeps easing
    // toward the wide box's own and the chart stops being portrait, which is
    // right: a 500px container is a tablet, not a phone.
    for (const containerPx of [200, 224, 260, 320, 340]) {
      const box = pickChartBox(containerPx);
      expect(box.height).toBeGreaterThan(box.width);
    }
    // And the ratio grows monotonically as the container narrows, meeting the
    // wide box's own ratio at the breakpoint so crossing it does not jump.
    const ratios = [200, 300, 400, 500, 620].map((px) => {
      const box = pickChartBox(px);
      return box.height / box.width;
    });
    for (let i = 1; i < ratios.length; i += 1) {
      expect(ratios[i]).toBeLessThan(ratios[i - 1]);
    }
    expect(ratios[ratios.length - 1]).toBeCloseTo(DESKTOP_BOX.height / DESKTOP_BOX.width, 1);
    expect(DESKTOP_BOX.height).toBeLessThan(DESKTOP_BOX.width);
  });

  it("leaves room for a y label in the narrow box's left gutter", () => {
    // "0.50" is the widest y label the axis produces in the normal case.
    const box = pickChartBox(320);
    expect(estimateLabelWidth("0.50", box.fontSize)).toBeLessThan(box.padding.l);
  });
});

describe("fitAxisLabels", () => {
  const wide: AxisTick[] = [
    { x: 20, label: "0.5" },
    { x: 60, label: "Replacement level" },
    { x: 100, label: "1.5" },
    { x: 140, label: "2.0" },
  ];
  const isReplacement = (t: AxisTick) => t.label === "Replacement level";

  it("keeps the replacement label and drops the decimals it would smear into", () => {
    const kept = fitAxisLabels(wide, 10, 4, isReplacement);
    expect(kept.map((t) => t.label)).toContain("Replacement level");
    // "Replacement level" is ~94 units wide at fontSize 10, centred on x=60,
    // so it covers 13 to 107 and swallows both 0.5 and 1.5.
    expect(kept.map((t) => t.label)).not.toContain("0.5");
    expect(kept.map((t) => t.label)).not.toContain("1.5");
    expect(kept.map((t) => t.label)).toContain("2.0");
  });

  it("returns labels in x order regardless of the order they were placed in", () => {
    const kept = fitAxisLabels(wide, 10, 4, isReplacement);
    const xs = kept.map((t) => t.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("keeps everything when there is room", () => {
    const roomy: AxisTick[] = [
      { x: 0, label: "1" },
      { x: 100, label: "10" },
      { x: 200, label: "20" },
      { x: 300, label: "30" },
    ];
    expect(fitAxisLabels(roomy, 9, 4, () => false)).toHaveLength(4);
  });

  it("drops a colliding label rather than overlapping it, with no priority set", () => {
    const tight: AxisTick[] = [
      { x: 0, label: "10" },
      { x: 6, label: "20" },
      { x: 200, label: "30" },
    ];
    const kept = fitAxisLabels(tight, 10, 4, () => false);
    expect(kept.map((t) => t.label)).toEqual(["10", "30"]);
  });

  it("handles an empty axis", () => {
    expect(fitAxisLabels([], 10, 4, () => false)).toEqual([]);
  });

  it("never drops a priority label, even when two of them would collide", () => {
    // Two priority labels overlapping is a design problem for the caller, not
    // something to resolve silently by hiding one of them.
    const both: AxisTick[] = [
      { x: 10, label: "Replacement level" },
      { x: 20, label: "Replacement level" },
    ];
    expect(fitAxisLabels(both, 10, 4, isReplacement)).toHaveLength(2);
  });
});
