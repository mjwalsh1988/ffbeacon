import { describe, it, expect } from "vitest";
import { computeEdge, visibleRows } from "./edge";
import { METRICS, type MetricSide } from "./metrics";
import {
  shareHigh,
  shareLow,
  shareSigned,
  youthScore,
  safetyScore,
  healthScore,
} from "./scoring";
import { EMPTY_EXTRAS_FIXTURE, makeSide } from "./_test-kit";
import { LENSES } from "./types";

/**
 * The Beacon Edge exists to fix one specific bug: a headline verdict computed
 * separately from the table below it, so the two could disagree. These tests pin
 * the properties that make them provably agree.
 */

describe("share primitives", () => {
  it("returns null when either side is missing, never 0.5", () => {
    // "We do not know" and "they are even" must not collapse together, because a
    // missing metric that scored 0.5 would silently drag every verdict toward a
    // tie for a reason that has nothing to do with the players.
    expect(shareHigh(null, 100)).toBeNull();
    expect(shareHigh(100, null)).toBeNull();
    expect(shareLow(null, 4)).toBeNull();
    expect(shareLow(4, null)).toBeNull();
    expect(shareSigned(null, 1)).toBeNull();
  });

  it("splits evenly when both sides are equal", () => {
    expect(shareHigh(5000, 5000)).toBeCloseTo(0.5, 10);
    expect(shareLow(12, 12)).toBeCloseTo(0.5, 10);
    expect(shareSigned(-3, -3)).toBeCloseTo(0.5, 10);
  });

  it("treats a zero-zero pair as even rather than dividing by zero", () => {
    expect(shareHigh(0, 0)).toBe(0.5);
  });

  it("inverts rank metrics so a better rank wins", () => {
    const s = shareLow(1, 100);
    expect(s).not.toBeNull();
    expect(s as number).toBeGreaterThan(0.5);
  });

  it("keeps a signed metric ordered without letting a negative flip the sign", () => {
    // A player down 12% should still score below a player up 3%, and both shares
    // must stay inside 0..1.
    const s = shareSigned(-12, 3);
    expect(s).not.toBeNull();
    expect(s as number).toBeLessThan(0.5);
    expect(s as number).toBeGreaterThan(0);
  });

  it("scores youth on an absolute scale, clamped at both ends", () => {
    expect(youthScore(21)).toBe(1);
    expect(youthScore(22)).toBe(1);
    expect(youthScore(28)).toBe(0);
    expect(youthScore(34)).toBe(0);
    expect(youthScore(25)).toBeCloseTo(0.5, 10);
    expect(youthScore(null)).toBeNull();
  });

  it("reads a healthy player as fully available and a season-ending tag as zero", () => {
    expect(healthScore(null)).toBe(1);
    expect(healthScore("Q")).toBeGreaterThan(0.5);
    expect(healthScore("Out")).toBeLessThan(0.2);
    expect(healthScore("IR")).toBe(0);
  });

  it("prefers measured scoring spread over the market proxy for safety", () => {
    const player = makeSide({ age: 25, tier: 3, change30dPct: 0 }).player;
    const metronome = safetyScore(player, 0.35);
    const lottery = safetyScore(player, 1.1);
    expect(metronome).not.toBeNull();
    expect(lottery).not.toBeNull();
    expect(metronome as number).toBeGreaterThan(lottery as number);
  });
});

describe("the composite is the table", () => {
  const a = makeSide({ value: 8000, overallRank: 3, positionRank: 2, tier: 1, age: 23 });
  const b = makeSide({ value: 4000, overallRank: 40, positionRank: 18, tier: 3, age: 29 });

  it("makes every contribution sum to exactly the margin over 50", () => {
    // This identity is what the contribution chart draws. If it ever stops
    // holding, the chart becomes a decoration rather than the decomposed verdict.
    for (const lens of LENSES) {
      const { edge } = computeEdge(a, b, lens.id, false);
      if (edge.metricsUsed === 0) continue;
      const sum = edge.contributions.reduce((s, c) => s + c.contribution, 0);
      expect(sum).toBeCloseTo(edge.aPct / 100 - 0.5, 2);
    }
  });

  it("normalizes the weights of the metrics that resolved to exactly 1", () => {
    for (const lens of LENSES) {
      const { edge } = computeEdge(a, b, lens.id, false);
      if (edge.metricsUsed === 0) continue;
      const total = edge.contributions.reduce((s, c) => s + c.weight, 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });

  it("always splits the meter across exactly one hundred percent", () => {
    const { edge } = computeEdge(a, b, "dynasty", false);
    expect(edge.aPct + edge.bPct).toBe(100);
  });

  it("gives the clearly better player the edge", () => {
    const { edge } = computeEdge(a, b, "dynasty", false);
    expect(edge.leader).toBe("a");
    expect(edge.aPct).toBeGreaterThan(50);
  });

  it("emits one row per metric and no row carries a weight it did not earn", () => {
    const { rows, edge } = computeEdge(a, b, "dynasty", false);
    expect(rows).toHaveLength(METRICS.length);
    const scoredKeys = new Set(edge.contributions.map((c) => c.key));
    for (const row of rows) {
      if (row.weight > 0) expect(scoredKeys.has(row.key)).toBe(true);
      else expect(scoredKeys.has(row.key)).toBe(false);
    }
  });

  it("never counts a blended row, so its inputs are not double counted", () => {
    const { edge } = computeEdge(a, b, "dynasty", false);
    const blended = METRICS.filter((m) => !m.scored).map((m) => m.key);
    expect(blended.length).toBeGreaterThan(0);
    for (const key of blended) {
      expect(edge.contributions.some((c) => c.key === key)).toBe(false);
    }
  });

  it("never hides a row that moved the verdict", () => {
    // The contribution chart names categories; a reader has to be able to find
    // every one of them in the table underneath.
    for (const lens of LENSES) {
      const { rows, edge } = computeEdge(a, b, lens.id, false);
      const shown = new Set(visibleRows(rows).map((r) => r.key));
      for (const c of edge.contributions) {
        expect(shown.has(c.key)).toBe(true);
      }
    }
  });

  it("still shows a blended row in the table even though it does not score", () => {
    const { rows } = computeEdge(a, b, "dynasty", false);
    const dynastyRow = rows.find((r) => r.key === "dynasty");
    expect(dynastyRow).toBeDefined();
    expect(dynastyRow!.weight).toBe(0);
    expect(dynastyRow!.aDisplay).not.toBe("-");
  });
});

describe("missing data drops out instead of voting for a tie", () => {
  it("scores nothing and reports a toss-up when neither player has any data", () => {
    const blank = makeSide({});
    const { edge } = computeEdge(blank, blank, "dynasty", false);
    expect(edge.metricsUsed).toBe(0);
    expect(edge.label).toBe("Toss-Up");
    expect(edge.aPct).toBe(50);
    expect(edge.basis).toBe("not enough data");
  });

  it("ignores a metric only one side has", () => {
    // B has no value at all. The value metric must not resolve, so the verdict
    // has to come from the metrics both players actually have.
    const a = makeSide({ value: 9000, overallRank: 2, age: 24 });
    const b = makeSide({ overallRank: 4, age: 24 });
    const { edge } = computeEdge(a, b, "dynasty", false);
    expect(edge.contributions.some((c) => c.key === "value")).toBe(false);
    expect(edge.contributions.some((c) => c.key === "overall-rank")).toBe(true);
  });

  it("produces a real verdict from a single resolved metric", () => {
    const a = makeSide({ overallRank: 1 });
    const b = makeSide({ overallRank: 150 });
    const { edge } = computeEdge(a, b, "dynasty", false);
    expect(edge.metricsUsed).toBe(1);
    expect(edge.contributions[0].weight).toBeCloseTo(1, 10);
    expect(edge.leader).toBe("a");
  });

  it("keeps the split finite and inside the meter for every lens on sparse data", () => {
    const a = makeSide({ value: 1 });
    const b = makeSide({ value: 9999 });
    for (const lens of LENSES) {
      const { edge } = computeEdge(a, b, lens.id, false);
      expect(Number.isFinite(edge.aPct)).toBe(true);
      expect(edge.aPct).toBeGreaterThanOrEqual(0);
      expect(edge.aPct).toBeLessThanOrEqual(100);
    }
  });
});

describe("lenses reweight without changing the measurements", () => {
  const a = makeSide({
    value: 6000,
    overallRank: 30,
    age: 22,
    projectionPoints: 120,
    beatRate: 0.4,
    weeksPlayed: 20,
  });
  const b = makeSide({
    value: 6000,
    overallRank: 8,
    age: 29,
    projectionPoints: 240,
    beatRate: 0.7,
    weeksPlayed: 20,
  });

  it("sends the young player the dynasty edge and the producer the win-now edge", () => {
    const dynasty = computeEdge(a, b, "dynasty", false).edge;
    const winNow = computeEdge(a, b, "win-now", false).edge;
    expect(dynasty.aPct).toBeGreaterThan(winNow.aPct);
  });

  it("reports the same share for a metric no matter which lens is active", () => {
    const dynastyRows = computeEdge(a, b, "dynasty", false).rows;
    const weekRows = computeEdge(a, b, "this-week", false).rows;
    for (const row of dynastyRows) {
      const other = weekRows.find((r) => r.key === row.key);
      expect(other).toBeDefined();
      expect(other!.share).toEqual(row.share);
      expect(other!.aDisplay).toBe(row.aDisplay);
    }
  });
});

describe("league impact metrics", () => {
  it("stays out of the composite entirely when no league is connected", () => {
    const a = makeSide({ value: 5000 });
    const b = makeSide({ value: 5000 });
    const { edge } = computeEdge(a, b, "win-now", false);
    for (const key of ["lineup-impact", "weeks-starting", "playoff-odds"]) {
      expect(edge.contributions.some((c) => c.key === key)).toBe(false);
    }
  });

  it("carries real weight in the win-now lens once a league is connected", () => {
    const a = makeSide({ value: 5000, netPointsPerWeek: 6.2, weeksStarting: 10 });
    const b = makeSide({ value: 5000, netPointsPerWeek: 0.1, weeksStarting: 1 });
    const { edge } = computeEdge(a, b, "win-now", false);
    const lineup = edge.contributions.find((c) => c.key === "lineup-impact");
    expect(lineup).toBeDefined();
    expect(lineup!.weight).toBeGreaterThan(0.1);
    expect(edge.leader).toBe("a");
  });
});

describe("metric registry integrity", () => {
  it("uses a unique key for every metric", () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every lens at least some weight to work with", () => {
    for (const lens of LENSES) {
      const total = METRICS.filter((m) => m.scored).reduce(
        (s, m) => s + (m.weights[lens.id] ?? 0),
        0,
      );
      expect(total).toBeGreaterThan(0.5);
    }
  });

  it("never weights a row it refuses to score", () => {
    for (const metric of METRICS) {
      if (metric.scored) continue;
      for (const lens of LENSES) {
        expect(metric.weights[lens.id]).toBe(0);
      }
    }
  });

  it("renders a dash rather than throwing when a side is completely empty", () => {
    const blank: MetricSide = { player: makeSide({}).player, extras: EMPTY_EXTRAS_FIXTURE, league: null };
    for (const metric of METRICS) {
      expect(() => metric.display(blank)).not.toThrow();
      expect(() => metric.note?.(blank)).not.toThrow();
      expect(() => metric.share(blank, blank)).not.toThrow();
    }
  });
});
