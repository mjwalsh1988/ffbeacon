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
