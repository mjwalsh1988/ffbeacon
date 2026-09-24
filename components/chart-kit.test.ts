import { describe, it, expect } from "vitest";
import { POSITION_SERIES, markerPath, type SeriesStyle } from "./chart-kit";
import { PULSE_POSITIONS } from "@/lib/power-pulse/types";

const MARKERS: SeriesStyle["marker"][] = ["circle", "square", "diamond", "triangle", "cross", "star"];

describe("markerPath", () => {
  it("returns a non-empty path for every marker shape", () => {
    for (const marker of MARKERS) {
      const d = markerPath(marker, 10, 10, 4);
      expect(d.length).toBeGreaterThan(0);
      expect(d.startsWith("M")).toBe(true);
    }
  });

  it("returns a distinct path string for every shape", () => {
    const paths = MARKERS.map((marker) => markerPath(marker, 10, 10, 4));
    expect(new Set(paths).size).toBe(MARKERS.length);
  });
});

describe("POSITION_SERIES", () => {
  it("carries an entry for every pulse position", () => {
    for (const position of PULSE_POSITIONS) {
      expect(POSITION_SERIES[position]).toBeDefined();
    }
  });

  it("pins QB to brand purple and RB to brand cyan", () => {
    expect(POSITION_SERIES.QB.color).toBe("#A855F7");
    expect(POSITION_SERIES.RB.color).toBe("#22D3EE");
  });

  it("gives every position a pairwise-distinct color", () => {
    const colors = PULSE_POSITIONS.map((p) => POSITION_SERIES[p].color);
    expect(new Set(colors).size).toBe(PULSE_POSITIONS.length);
  });

  it("gives every position a pairwise-distinct dash pattern", () => {
    const dashes = PULSE_POSITIONS.map((p) => POSITION_SERIES[p].dash ?? "solid");
    expect(new Set(dashes).size).toBe(PULSE_POSITIONS.length);
  });

  it("gives every position a pairwise-distinct marker shape", () => {
    const markers = PULSE_POSITIONS.map((p) => POSITION_SERIES[p].marker);
    expect(new Set(markers).size).toBe(PULSE_POSITIONS.length);
  });

  it("uses only hex colors", () => {
    for (const position of PULSE_POSITIONS) {
      expect(POSITION_SERIES[position].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("POSITION_SERIES across all nine positions (IDP-103)", () => {
  const NINE = PULSE_POSITIONS;
  const style = (p: string) => POSITION_SERIES[p as keyof typeof POSITION_SERIES];

  it("carries a style for every offensive and defensive position", () => {
    for (const p of NINE) expect(style(p)).toBeDefined();
  });

  it("keeps colour, dash and marker pairwise distinct over the nine", () => {
    expect(new Set(NINE.map((p) => style(p).color)).size).toBe(NINE.length);
    expect(new Set(NINE.map((p) => style(p).dash ?? "solid")).size).toBe(NINE.length);
    expect(new Set(NINE.map((p) => style(p).marker)).size).toBe(NINE.length);
  });

  it("draws a distinct path for the three new marker shapes", () => {
    const shapes: SeriesStyle["marker"][] = ["pentagon", "triangle-down", "hourglass", ...MARKERS];
    const paths = shapes.map((m) => markerPath(m, 10, 10, 4));
    expect(new Set(paths).size).toBe(shapes.length);
  });

  // The product ships one theme (dark). Series lines are checked against both
  // dark surfaces a chart sits on: the composited panel and the raised surface.
  it("clears 3:1 against both chart surfaces for every series line", () => {
    for (const p of NINE) {
      expect(contrast(style(p).color, "#0B0B14")).toBeGreaterThanOrEqual(3);
      expect(contrast(style(p).color, "#0F0F1A")).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("PLAYER_SERIES after the widening (IDP-120, hazard E)", () => {
  it("still opens with the six offensive styles and holds eight entries", async () => {
    const { PLAYER_SERIES } = await import("./chart-kit");
    expect(PULSE_POSITIONS).toHaveLength(9);
    expect(PLAYER_SERIES).toHaveLength(8);
    expect(PLAYER_SERIES.slice(0, 6)).toEqual(
      (["QB", "RB", "WR", "TE", "K", "DEF"] as const).map((p) => POSITION_SERIES[p]),
    );
  });
});
