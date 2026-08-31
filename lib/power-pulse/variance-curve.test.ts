import { describe, it, expect } from "vitest";
import {
  VARIANCE_CURVES,
  cvForPoints,
  curveFor,
  type ScoringBase,
} from "./variance-curve";
import { PULSE_POSITIONS, type PulsePosition } from "./types";

const BASES: ScoringBase[] = ["pts_ppr", "pts_half_ppr", "pts_std"];
const RECEPTION_POSITIONS: PulsePosition[] = ["RB", "WR", "TE"];

describe("the curves themselves", () => {
  it("covers every position under every scoring base", () => {
    for (const base of BASES) {
      for (const position of PULSE_POSITIONS) {
        expect(
          curveFor(base, position).length,
          `${base} ${position}`,
        ).toBeGreaterThan(1);
      }
    }
  });

  it("orders every anchor list by descending points, which cvForPoints relies on", () => {
    for (const base of BASES) {
      for (const position of PULSE_POSITIONS) {
        const anchors = curveFor(base, position);
        for (let i = 1; i < anchors.length; i += 1) {
          expect(
            anchors[i].points,
            `${base} ${position} anchor ${i}`,
          ).toBeLessThan(anchors[i - 1].points);
        }
      }
    }
  });

  it("keeps every measured value inside a believable range", () => {
    for (const base of BASES) {
      for (const position of PULSE_POSITIONS) {
        for (const a of curveFor(base, position)) {
          expect(a.cv).toBeGreaterThan(0.2);
          expect(a.cv).toBeLessThan(1.2);
          expect(a.points).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("what the measurement actually found", () => {
  it("puts receivers above running backs through the whole startable range", () => {
    // The correction. Volume is stability, so the top two dozen backs are the
    // steadier group, and only past rank 25 does committee usage flip it.
    const rb = curveFor("pts_ppr", "RB");
    const wr = curveFor("pts_ppr", "WR");
    for (const rank of [0, 1, 2, 3]) {
      expect(wr[rank].cv, `startable band ${rank}`).toBeGreaterThan(
        rb[rank].cv,
      );
    }
  });

  it("flips back for the deep bench, which is what the old sample was measuring", () => {
    const rb = curveFor("pts_ppr", "RB");
    const wr = curveFor("pts_ppr", "WR");
    expect(rb[rb.length - 1].cv).toBeGreaterThan(wr[wr.length - 1].cv);
  });

  it("raises reception positions as reception scoring is taken away", () => {
    for (const position of RECEPTION_POSITIONS) {
      const ppr = curveFor("pts_ppr", position)[0].cv;
      const half = curveFor("pts_half_ppr", position)[0].cv;
      const std = curveFor("pts_std", position)[0].cv;
      expect(half, `${position} half`).toBeGreaterThan(ppr);
      expect(std, `${position} std`).toBeGreaterThan(half);
    }
  });

  it("leaves quarterbacks, kickers and defenses identical across all three bases", () => {
    // They score no receptions, so a difference here would be a transcription
    // error rather than a finding.
    for (const position of ["QB", "K", "DEF"] as PulsePosition[]) {
      const ppr = curveFor("pts_ppr", position);
      expect(curveFor("pts_half_ppr", position)).toEqual(ppr);
      expect(curveFor("pts_std", position)).toEqual(ppr);
    }
  });
});

describe("cvForPoints", () => {
  const wr = curveFor("pts_ppr", "WR");

  it("returns the elite figure at and above the top anchor", () => {
    expect(cvForPoints(wr, 20.1)).toBeCloseTo(0.502, 5);
    expect(cvForPoints(wr, 30)).toBeCloseTo(0.502, 5);
  });

  it("returns the deep-bench figure at and below the bottom anchor", () => {
    expect(cvForPoints(wr, 9.9)).toBeCloseTo(0.628, 5);
    expect(cvForPoints(wr, 0.5)).toBeCloseTo(0.628, 5);
  });

  it("interpolates between two anchors", () => {
    // Halfway between the 20.1 and 16.5 anchors.
    const mid = cvForPoints(wr, (20.1 + 16.5) / 2);
    expect(mid).toBeCloseTo((0.502 + 0.534) / 2, 3);
  });

  it("never extrapolates past the measured range", () => {
    // A straight line drawn off the end of real data reaches absurd values
    // within a few points, so the ends are flat on purpose.
    const highest = cvForPoints(wr, 1000)!;
    const lowest = cvForPoints(wr, -50)!;
    expect(highest).toBe(wr[0].cv);
    expect(lowest).toBe(wr[wr.length - 1].cv);
  });

  it("is monotone across the range for a monotone curve", () => {
    const qb = curveFor("pts_ppr", "QB");
    let previous = -Infinity;
    for (let points = 25; points >= 5; points -= 0.5) {
      const cv = cvForPoints(qb, points)!;
      expect(cv).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = cv;
    }
  });

  it("says nothing rather than guessing when there is no curve", () => {
    expect(cvForPoints([], 12)).toBeNull();
  });

  it("survives a projection that is not a number", () => {
    expect(cvForPoints(wr, Number.NaN)).toBe(wr[wr.length - 1].cv);
  });
});

describe("curveFor", () => {
  it("falls back to PPR for a scoring base it does not recognise", () => {
    expect(curveFor("pts_something_new", "WR")).toEqual(
      VARIANCE_CURVES.pts_ppr.WR,
    );
  });
});
