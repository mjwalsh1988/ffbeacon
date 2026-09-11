import { describe, it, expect } from "vitest";
import { computeEdge, computeGroupEdge, visibleRows } from "./edge";
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
import { LENSES, type LensId } from "./types";

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

/**
 * computeGroupEdge generalises the same engine to N sides. These tests pin the
 * properties that keep it a true generalisation rather than a second, possibly
 * disagreeing, implementation: at N equal to 2 it must land on the same
 * leader, label AND composite as computeEdge (not merely point the same
 * direction), and at every N the per-side contributions must sum to that
 * side's own composite.
 *
 * computeEdge exposes aShare only as a rounded integer percentage (aPct), so
 * the unrounded composite is recovered from the identity the other describe
 * block above already pins: aShare === 0.5 + sum(contributions[*].contribution).
 */
function pairwiseAShare(a: MetricSide, b: MetricSide, lens: LensId): number {
  const { edge } = computeEdge(a, b, lens, false);
  return 0.5 + edge.contributions.reduce((s, c) => s + c.contribution, 0);
}

function assertGroupMatchesPairwise(a: MetricSide, b: MetricSide, lens: LensId) {
  const pairwise = computeEdge(a, b, lens, false).edge;
  const group = computeGroupEdge([a, b], lens);
  const groupLeader = group.leader === null ? "even" : group.leader === 0 ? "a" : "b";
  expect(groupLeader).toBe(pairwise.leader);
  expect(group.label).toBe(pairwise.label);
  expect(group.sides[0].composite).toBeCloseTo(pairwiseAShare(a, b, lens), 9);
}

/** Small, seeded PRNG (mulberry32) so the generated sweep is deterministic
 * across runs and machines: a failure has to be reproducible to be fixable. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSide(rand: () => number, name: string): MetricSide {
  const pick = <T,>(options: T[]): T => options[Math.floor(rand() * options.length)];
  // Each field independently has a chance of being omitted, so the sweep
  // exercises the "metric drops out" path as often as the "metric resolves"
  // path, the same mix real player data produces.
  const maybe = (chance: number) => rand() < chance;
  return makeSide({
    name,
    value: maybe(0.8) ? Math.round(100 + rand() * 9900) : undefined,
    overallRank: maybe(0.8) ? Math.round(1 + rand() * 300) : undefined,
    positionRank: maybe(0.8) ? Math.round(1 + rand() * 80) : undefined,
    tier: maybe(0.7) ? Math.round(1 + rand() * 5) : undefined,
    age: maybe(0.8) ? Math.round(20 + rand() * 16) : undefined,
    change30dPct: maybe(0.7) ? Math.round((rand() - 0.5) * 60) : undefined,
    trend30d: maybe(0.5) ? pick(["up", "down", "stable"] as const) : undefined,
    depthRole: maybe(0.6) ? pick(["Starter", "Backup", "Depth Piece", "Dart Throw"]) : undefined,
    injuryStatus: maybe(0.2) ? pick(["Q", "D", "O", "IR"]) : undefined,
    projectionPoints: maybe(0.7) ? Math.round(rand() * 4000) / 10 : undefined,
    beatRate: maybe(0.6) ? Math.round(rand() * 100) / 100 : undefined,
    availabilityRate: maybe(0.6) ? Math.round(rand() * 100) / 100 : undefined,
    ratioStdev: maybe(0.6) ? Math.round((0.2 + rand() * 1.1) * 100) / 100 : undefined,
    weeksPlayed: maybe(0.7) ? Math.round(rand() * 20) : undefined,
    netPointsPerWeek: maybe(0.5) ? Math.round((rand() - 0.3) * 150) / 10 : undefined,
    weeksStarting: maybe(0.5) ? Math.round(rand() * 14) : undefined,
    playoffOddsAfter: maybe(0.5) ? Math.round(rand() * 100) / 100 : undefined,
  });
}

describe("computeGroupEdge reproduces computeEdge at N = 2", () => {
  // Same fixture computeEdge's own tests use: a clearly better dynasty asset
  // against a clearly worse one.
  const clearPairA = makeSide({ value: 8000, overallRank: 3, positionRank: 2, tier: 1, age: 23 });
  const clearPairB = makeSide({ value: 4000, overallRank: 40, positionRank: 18, tier: 3, age: 29 });

  // A young, cheaply-drafted producer against an old, better-drafted one, the
  // same shape of pair the pairwise lens tests use to show the lenses pull
  // apart: dynasty favors the youth, win-now and this-week favor the production.
  const mixedPairA = makeSide({
    value: 6000,
    overallRank: 5,
    age: 21,
    tier: 1,
    projectionPoints: 50,
    beatRate: 0.2,
    weeksPlayed: 20,
  });
  const mixedPairB = makeSide({
    value: 6000,
    overallRank: 45,
    age: 33,
    tier: 4,
    projectionPoints: 500,
    beatRate: 0.92,
    weeksPlayed: 20,
  });

  // A single resolved metric, extreme enough that health's tied tie-breaker
  // weight cannot move the label.
  const lopsidedPairA = makeSide({ overallRank: 1 });
  const lopsidedPairB = makeSide({ overallRank: 150 });

  // Sparse data on both sides, extreme enough that only one metric resolves.
  const sparsePairA = makeSide({ value: 1 });
  const sparsePairB = makeSide({ value: 9999 });

  // Close enough to sit near a label boundary rather than deep inside one, so
  // the parity claim is tested where a rounding slip would actually show: a
  // small, mixed lead (better value and rank, worse age and trend) that lands
  // just inside "Slight Edge" territory rather than a blowout.
  const borderlinePairA = makeSide({
    value: 5400,
    overallRank: 34,
    positionRank: 14,
    tier: 3,
    age: 28,
    change30dPct: -3,
  });
  const borderlinePairB = makeSide({
    value: 4900,
    overallRank: 41,
    positionRank: 17,
    tier: 3,
    age: 25,
    change30dPct: 4,
  });

  const fixtures: [string, MetricSide, MetricSide][] = [
    ["a clearly better dynasty asset", clearPairA, clearPairB],
    ["a young low producer against an old high producer", mixedPairA, mixedPairB],
    ["one lopsided metric", lopsidedPairA, lopsidedPairB],
    ["sparse data on both sides", sparsePairA, sparsePairB],
    ["a borderline pair near a label threshold", borderlinePairA, borderlinePairB],
  ];

  for (const [name, a, b] of fixtures) {
    for (const lens of LENSES) {
      it(`agrees with computeEdge on leader, label and composite: ${name}, ${lens.id} lens`, () => {
        assertGroupMatchesPairwise(a, b, lens.id);
      });
    }
  }

  it("confirms the borderline fixture actually sits near a threshold rather than deep inside a band", () => {
    // The fixture only varies fields that carry weight under dynasty and
    // win-now (value, rank, tier, age, trend); every one of those metrics
    // weighs zero under this-week (see metrics.ts), so this-week legitimately
    // resolves nothing and lands on the exact 0.5 toss-up default, not a
    // near-threshold split. That is asserted on its own below.
    for (const lens of ["dynasty", "win-now"] as const) {
      const share = pairwiseAShare(borderlinePairA, borderlinePairB, lens);
      const leaderShare = Math.max(share, 1 - share);
      expect(leaderShare).toBeGreaterThan(0.505);
      expect(leaderShare).toBeLessThan(0.6);
    }
  });

  it("resolves nothing for the borderline fixture under this-week, since none of its fields carry weight there", () => {
    const pairwise = computeEdge(borderlinePairA, borderlinePairB, "this-week", false).edge;
    expect(pairwise.metricsUsed).toBe(0);
    expect(pairwise.label).toBe("Toss-Up");
  });

  describe("a seeded sweep of generated pairs", () => {
    const rand = mulberry32(20260910);
    const pairs: [MetricSide, MetricSide][] = Array.from({ length: 220 }, (_, i) => [
      randomSide(rand, `sweep-a-${i}`),
      randomSide(rand, `sweep-b-${i}`),
    ]);

    for (const lens of LENSES) {
      it(`agrees with computeEdge on leader, label and composite across 220 generated pairs, ${lens.id} lens`, () => {
        for (const [a, b] of pairs) {
          assertGroupMatchesPairwise(a, b, lens.id);
        }
      });
    }
  });
});

describe("computeGroupEdge composites decompose into contributions", () => {
  const players = [
    makeSide({ value: 9000, overallRank: 1, positionRank: 1, tier: 1, age: 22 }),
    makeSide({ value: 7000, overallRank: 10, positionRank: 4, tier: 2, age: 24 }),
    makeSide({ value: 5000, overallRank: 25, positionRank: 9, tier: 3, age: 27 }),
    makeSide({ value: 3000, overallRank: 60, positionRank: 20, tier: 4, age: 30 }),
    makeSide({ value: 2000, overallRank: 90, positionRank: 30, tier: 5, age: 31 }),
    makeSide({ value: 1000, overallRank: 130, positionRank: 40, tier: 6, age: 33 }),
    makeSide({ value: 500, overallRank: 170, positionRank: 55, tier: 6, age: 34 }),
    makeSide({ value: 100, overallRank: 220, positionRank: 70, tier: 6, age: 35 }),
  ];

  it("sums each side's contributions to exactly its own composite, for N = 3 and N = 8", () => {
    for (const count of [3, 8]) {
      const group = computeGroupEdge(players.slice(0, count), "dynasty");
      for (const side of group.sides) {
        const sum = side.contributions.reduce((s, c) => s + c.contribution, 0);
        expect(sum).toBeCloseTo(side.composite, 10);
      }
    }
  });

  it("renormalizes weights to 1 across the metrics that resolved, for every side", () => {
    const group = computeGroupEdge(players, "dynasty");
    for (const side of group.sides) {
      const total = side.contributions.reduce((s, c) => s + c.weight, 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });

  it("orders eight sides by composite the same way twice in a row (deterministic)", () => {
    const first = computeGroupEdge(players, "dynasty");
    const second = computeGroupEdge(players, "dynasty");
    const orderOf = (g: ReturnType<typeof computeGroupEdge>) =>
      g.sides.map((s) => s.composite).join(",");
    expect(orderOf(first)).toBe(orderOf(second));
  });

  it("ranks the plainly stronger dynasty assets above the plainly weaker ones, for N = 3 and N = 8", () => {
    for (const count of [3, 8]) {
      const group = computeGroupEdge(players.slice(0, count), "dynasty");
      const composites = group.sides.map((s) => s.composite);
      for (let i = 1; i < composites.length; i += 1) {
        expect(composites[i - 1]).toBeGreaterThan(composites[i]);
      }
      expect(group.leader).toBe(0);
    }
  });

  it("marks a different side Best on each metric when no one sweeps every row", () => {
    // Rich but old, cheap but young, and a middling third wheel: nobody wins
    // every category, so the Best badge has to move between sides.
    const richOld = makeSide({ value: 9000, overallRank: 40, age: 33 });
    const cheapYoung = makeSide({ value: 1000, overallRank: 20, age: 21 });
    const middling = makeSide({ value: 5000, overallRank: 10, age: 26 });
    const group = computeGroupEdge([richOld, cheapYoung, middling], "dynasty");

    const bestOf = (key: string) =>
      group.sides.findIndex((s) => s.contributions.find((c) => c.key === key)?.isBest);

    expect(bestOf("value")).toBe(0);
    expect(bestOf("age")).toBe(1);
    expect(bestOf("overall-rank")).toBe(2);
  });
});

describe("computeGroupEdge drops a metric only for the sides whose pairs never resolve", () => {
  // Under the old rank-based engine, a metric was usable only when the whole
  // group had a scalar on two or more sides, so "only one side can supply it"
  // and "excluded everywhere" were the same case. The new engine counts per
  // side, from a per-pair share() rather than a group-wide scalar count, so
  // this rewrites the old test to actually exercise that distinction: two of
  // three sides can supply the metric and the third genuinely cannot.
  it("excludes value from the composite when only one of three sides has it, and renormalizes the rest", () => {
    const withValue = makeSide({ value: 5000, overallRank: 20, age: 24 });
    const noValueA = makeSide({ overallRank: 5, age: 22 });
    const noValueB = makeSide({ overallRank: 50, age: 30 });

    const group = computeGroupEdge([withValue, noValueA, noValueB], "dynasty");
    for (const side of group.sides) {
      expect(side.contributions.some((c) => c.key === "value")).toBe(false);
    }

    // overall-rank had data on all three sides, so it must still resolve and
    // pick up the weight value would otherwise have carried.
    const rankRow = group.sides[0].contributions.find((c) => c.key === "overall-rank");
    expect(rankRow).toBeDefined();

    const pairwiseWithoutValue = computeGroupEdge([noValueA, noValueB], "dynasty");
    const rankWeightAlone = pairwiseWithoutValue.sides[0].contributions.find(
      (c) => c.key === "overall-rank",
    )?.weight;
    // Renormalizing over two sides (no value anywhere) versus three sides (value
    // present on one, still excluded) should land on the same renormalized
    // weight for overall-rank, since value never entered the resolvable set
    // either way.
    expect(rankRow?.weight).toBeCloseTo(rankWeightAlone ?? -1, 10);
  });

  it("counts value for the two sides that both have it and excludes only the side that does not, using the raw pairwise share rather than a rank", () => {
    const richer = makeSide({ value: 5000, overallRank: 30 });
    const poorer = makeSide({ value: 3000, overallRank: 60 });
    const noValue = makeSide({ overallRank: 45 });

    const group = computeGroupEdge([richer, poorer, noValue], "dynasty");
    expect(group.sides[0].contributions.some((c) => c.key === "value")).toBe(true);
    expect(group.sides[1].contributions.some((c) => c.key === "value")).toBe(true);
    expect(group.sides[2].contributions.some((c) => c.key === "value")).toBe(false);

    // richer's only resolved pair for value is against poorer (its pair with
    // noValue never resolves), so its share IS metric.share(richer, poorer)
    // directly, not a rank-derived number. A rank-based engine would have
    // given richer a full 1.0 (or 0.75 with three ranked sides); the raw
    // pairwise ratio is neither.
    const richerValueRow = group.sides[0].contributions.find((c) => c.key === "value");
    const rawShare = computeEdge(richer, poorer, "dynasty", false).edge.contributions.find(
      (c) => c.key === "value",
    )?.share;
    expect(richerValueRow?.share).toBeCloseTo(rawShare ?? -1, 10);
    expect(richerValueRow?.share).not.toBeCloseTo(1, 2);
  });
});

describe("computeGroupEdge edge cases", () => {
  it("reports a toss-up with no leader, and the same zero metricsUsed as computeEdge, when nobody has any data", () => {
    // Under the old rank-based engine, health resolved here (a missing
    // injury status reads as fully healthy, per scoring.ts healthScore) even
    // though computeEdge's own blank-versus-blank test reports zero metrics
    // used, because health's share() explicitly returns null when both sides
    // are undesignated (metrics.ts) while its scalar() does not. The new
    // engine resolves a metric from share(), not scalar(), so the two blank
    // reads now agree: nothing resolves for a side with no data at all.
    const blank = makeSide({});
    const pairwise = computeEdge(blank, blank, "dynasty", false).edge;
    const group = computeGroupEdge([blank, blank, blank], "dynasty");
    expect(group.label).toBe("Toss-Up");
    expect(group.leader).toBeNull();
    expect(group.metricsUsed).toBe(0);
    expect(group.metricsUsed).toBe(pairwise.metricsUsed);
    for (const side of group.sides) {
      expect(side.contributions).toHaveLength(0);
      // 0.5, not 0: the same neutral default computeEdge's aShare keeps when
      // nothing resolves, so a side with no data reads as "unknown" rather
      // than "lost everything".
      expect(side.composite).toBe(0.5);
    }
  });

  it("never lets a tie crown a leader", () => {
    const same = makeSide({ value: 5000, overallRank: 10, age: 25 });
    const group = computeGroupEdge([same, same, same], "dynasty");
    expect(group.label).toBe("Toss-Up");
    expect(group.leader).toBeNull();
    const composites = group.sides.map((s) => s.composite);
    expect(composites[0]).toBeCloseTo(composites[1], 10);
    expect(composites[1]).toBeCloseTo(composites[2], 10);
  });
});
