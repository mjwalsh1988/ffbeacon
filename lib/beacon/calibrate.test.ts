import { describe, it, expect } from "vitest";
import {
  applyQuantileMap,
  buildSyntheticReference,
  calibrateSlice,
  fitQuantileMap,
  CALIBRATION_GRID_POINTS,
} from "./calibrate";
import { normalizeSlice, type SourcePlayerValue } from "./normalize";
import { combine } from "./engine";

const BAND = { floor: 0, ceiling: 10000 };
const WEIGHTS = new Map([
  ["ktc", 1],
  ["fantasycalc", 1],
  ["dynastyprocess", 1],
]);

/** Deterministic pseudo-random, so a failure is always reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A decaying value curve, roughly the shape a real value board has. */
function curve(rank: number): number {
  return Math.round(10000 * Math.exp(-rank / 120) + 5);
}

function pool(prefix: string, count: number, value: (i: number) => number): SourcePlayerValue[] {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `${prefix}${String(i).padStart(4, "0")}`,
    value: value(i),
  }));
}

/** Player ids are shared across sources: p0000 is the same player everywhere. */
function shared(count: number, value: (i: number) => number): SourcePlayerValue[] {
  return pool("p", count, value);
}

describe("fitQuantileMap", () => {
  it("is monotone non-decreasing on both axes", () => {
    const rnd = lcg(7);
    const xs = Array.from({ length: 300 }, () => rnd());
    const ys = Array.from({ length: 300 }, () => rnd() ** 2);
    const map = fitQuantileMap(xs, ys)!;
    expect(map.x.length).toBe(CALIBRATION_GRID_POINTS);
    for (let k = 1; k < map.x.length; k += 1) {
      expect(map.x[k]).toBeGreaterThanOrEqual(map.x[k - 1]);
      expect(map.y[k]).toBeGreaterThanOrEqual(map.y[k - 1]);
    }
  });

  it("anchors both endpoints on the true observed extremes, never clipping the top", () => {
    const xs = shared(200, (i) => curve(i)).map((p) => p.value / 10005);
    const ys = shared(200, (i) => curve(i) * 0.8).map((p) => p.value / 8004);
    const map = fitQuantileMap(xs, ys)!;
    expect(map.x[0]).toBeCloseTo(Math.min(...xs), 12);
    expect(map.x[map.x.length - 1]).toBeCloseTo(Math.max(...xs), 12);
    // The best player in the source lands exactly on the best player in the
    // reference. This is the bug an earlier binned fit had: it pulled the top
    // player down to a bin median.
    expect(applyQuantileMap(map, Math.max(...xs)).value).toBeCloseTo(Math.max(...ys), 12);
  });

  it("never invents a value above the fitted range", () => {
    const map = fitQuantileMap([0.1, 0.4, 0.9], [0.2, 0.5, 0.8])!;
    const above = applyQuantileMap(map, 5);
    expect(above.value).toBeLessThanOrEqual(0.8);
    expect(above.inRange).toBe(false);
  });

  it("keeps below-range players under the fitted minimum and in order", () => {
    const map = fitQuantileMap([0.2, 0.5, 0.9], [0.3, 0.6, 0.95])!;
    const a = applyQuantileMap(map, 0.15);
    const b = applyQuantileMap(map, 0.05);
    expect(a.inRange).toBe(false);
    expect(b.inRange).toBe(false);
    expect(a.value).toBeLessThan(0.3); // under the fitted minimum
    expect(b.value).toBeLessThan(a.value); // ordering preserved on the way down
    expect(b.value).toBeGreaterThanOrEqual(0);
  });

  it("answers a run of tied source values with one output", () => {
    const map = fitQuantileMap([0.1, 0.4, 0.4, 0.4, 0.9], [0.1, 0.3, 0.5, 0.7, 0.9])!;
    const a = applyQuantileMap(map, 0.4);
    const b = applyQuantileMap(map, 0.4);
    expect(a.value).toBe(b.value);
    expect(Number.isFinite(a.value)).toBe(true);
  });

  it("returns null when there is nothing to interpolate between", () => {
    expect(fitQuantileMap([0.5], [0.5])).toBeNull();
    expect(fitQuantileMap([], [])).toBeNull();
  });
});

describe("buildSyntheticReference", () => {
  it("only uses players every source ranks", () => {
    const ref = buildSyntheticReference({
      bySource: new Map([
        ["ktc", shared(300, curve)],
        ["fantasycalc", shared(200, curve)],
        ["dynastyprocess", shared(500, curve)],
      ]),
      minShared: 100,
    })!;
    expect(ref.sharedPlayers.length).toBe(200);
    expect(ref.values.size).toBe(200);
  });

  it("refuses to build below the shared-player minimum", () => {
    const ref = buildSyntheticReference({
      bySource: new Map([
        ["ktc", shared(120, curve)],
        ["fantasycalc", shared(80, curve)],
      ]),
      minShared: 100,
    });
    expect(ref).toBeNull();
  });

  it("anchors the top of the scale at 1 and stays inside [0,1]", () => {
    const ref = buildSyntheticReference({
      bySource: new Map([
        ["ktc", shared(250, curve)],
        ["fantasycalc", shared(250, (i) => curve(i) * 3 + 40)],
      ]),
      minShared: 100,
    })!;
    const values = [...ref.values.values()];
    expect(Math.max(...values)).toBeCloseTo(1, 12);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("calibrateSlice: list-length invariance (the defect this replaces)", () => {
  // Three sources that agree exactly about every player they both rank, and
  // differ only in how far down their lists go. Nothing about a player changes
  // between them, so nothing about their FF Beacon contribution should either.
  const ktc = shared(400, curve);
  const fantasycalc = shared(500, curve);
  const dynastyprocess = shared(650, curve);
  const bySource = new Map([
    ["ktc", ktc],
    ["fantasycalc", fantasycalc],
    ["dynastyprocess", dynastyprocess],
  ]);
  const reference = buildSyntheticReference({ bySource, minShared: 100 })!;

  it("gives identical contributions from lists of 400, 500, and 650", () => {
    const result = calibrateSlice({
      bySource,
      weights: WEIGHTS,
      band: BAND,
      minPlayers: 30,
      reference: reference.values,
    });

    // Players 0..19 sit inside the P99 winsorization head, where each source
    // clips at its own absolute threshold on purpose (outlier protection). That
    // is a deliberate difference, not list-length bias, so the invariance claim
    // is asserted from rank 20 down.
    for (let rank = 20; rank < 400; rank += 1) {
      const p = result.players.get(`p${String(rank).padStart(4, "0")}`)!;
      expect(p.contributions.length).toBe(3);
      const [a, b, c] = p.contributions.map((x) => x.calibratedScaled!);
      expect(b).toBeCloseTo(a, 12);
      expect(c).toBeCloseTo(a, 12);
    }
  });

  it("proves the test bites: the original method does NOT have this property", () => {
    const legacy = normalizeSlice({ bySource, weights: WEIGHTS, band: BAND, minPlayers: 30 });
    const p = legacy.players.get("p0100")!;
    const mapped = p.contributions.map((c) => c.mappedScaled);
    const spread = Math.max(...mapped) - Math.min(...mapped);
    expect(spread).toBeGreaterThan(0.01);
  });
});

describe("calibrateSlice: core guarantees", () => {
  const bySource = new Map([
    ["ktc", shared(400, curve)],
    ["fantasycalc", shared(300, (i) => curve(i) * 2.5 + 100)],
    ["dynastyprocess", shared(650, (i) => Math.round(curve(i) ** 0.9))],
  ]);
  const reference = buildSyntheticReference({ bySource, minShared: 100 })!;
  const input = {
    bySource,
    weights: WEIGHTS,
    band: BAND,
    minPlayers: 30,
    reference: reference.values,
  };

  it("is deterministic: same inputs and same reference produce identical output", () => {
    const a = calibrateSlice(input);
    const b = calibrateSlice(input);
    const dump = (r: typeof a) =>
      JSON.stringify(
        [...r.players.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([id, p]) => [
          id,
          p.value,
          p.scaled,
          p.coverage,
          p.contributions.map((c) => [c.source, c.calibratedScaled, c.inFittedRange]),
        ]),
      );
    expect(dump(a)).toBe(dump(b));
  });

  it("never reverses a source's ordering", () => {
    const result = calibrateSlice(input);
    for (const source of ["ktc", "fantasycalc", "dynastyprocess"]) {
      const rows = bySource
        .get(source)!
        .map((v) => ({
          raw: v.value,
          mapped: result.players
            .get(v.playerId)!
            .contributions.find((c) => c.source === source)!.calibratedScaled!,
        }))
        .sort((a, b) => a.raw - b.raw);
      let inversions = 0;
      for (let i = 1; i < rows.length; i += 1) {
        if (rows[i].mapped < rows[i - 1].mapped - 1e-12) inversions += 1;
      }
      expect(inversions).toBe(0);
    }
  });

  it("survives a source whose deep tail is one repeated value", () => {
    const degenerate = new Map(bySource);
    degenerate.set(
      "dynastyprocess",
      shared(650, (i) => (i < 260 ? curve(i) : 12)),
    );
    const ref = buildSyntheticReference({ bySource: degenerate, minShared: 100 })!;
    const result = calibrateSlice({ ...input, bySource: degenerate, reference: ref.values });

    expect(result.players.size).toBe(650);
    for (const p of result.players.values()) {
      expect(Number.isFinite(p.value)).toBe(true);
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(10000);
    }
    // The flat region stays where the tie is. Players above it keep real spread.
    const top = [...Array(200).keys()].map(
      (i) => result.players.get(`p${String(i).padStart(4, "0")}`)!.value,
    );
    expect(new Set(top.map((v) => Math.round(v))).size).toBeGreaterThan(150);
  });

  it("does not let one absurd outlier distort unrelated players", () => {
    const withOutlier = new Map(bySource);
    const ktcRows = bySource.get("ktc")!.map((r) => ({ ...r }));
    ktcRows[0] = { ...ktcRows[0], value: 9_000_000 };
    withOutlier.set("ktc", ktcRows);

    const clean = calibrateSlice(input);
    const dirty = calibrateSlice({ ...input, bySource: withOutlier });

    for (let rank = 50; rank < 300; rank += 1) {
      const id = `p${String(rank).padStart(4, "0")}`;
      const move = Math.abs(dirty.players.get(id)!.value - clean.players.get(id)!.value);
      expect(move).toBeLessThan(60); // under 0.6 percent of the 0..10000 band
    }
  });

  it("refuses to publish an uncalibrated board as calibrated", () => {
    // A reference that shares almost nothing with today's sources. Degrading
    // every source to raw P99 scaling would silently produce the old kind of
    // board under the new label, so this has to fail loudly instead.
    const strangerReference = new Map(
      Array.from({ length: 200 }, (_, i) => [`unknown${i}`, 1 - i / 200] as const),
    );
    expect(() => calibrateSlice({ ...input, reference: strangerReference })).toThrow(
      /Refusing to publish an uncalibrated board/,
    );
  });

  it("flags single-source players without discounting them", () => {
    // One deep player only DynastyProcess ranks, plus the same player added to a
    // second source. The coverage flag changes; the calibrated contribution from
    // DynastyProcess does not.
    const deepId = "p0600";
    const oneSource = calibrateSlice(input);
    const solo = oneSource.players.get(deepId)!;
    expect(solo.coverage).toBe(1);
    expect(solo.lowConfidence).toBe(true);

    const dpContribution = solo.contributions[0].calibratedScaled!;
    // The value is exactly the calibrated opinion of the only source that has
    // one. No depth penalty, no squeeze.
    expect(solo.scaled).toBeCloseTo(dpContribution, 12);
    expect(solo.value).toBeCloseTo(dpContribution * 10000, 9);
  });

  it("keeps a legitimate single-source player at his source's opinion (the Tuten case)", () => {
    // A two-source redraft board. FantasyCalc ranks a rookie back 69th;
    // KTC has never heard of him because its catalog is different, not because
    // the player is worthless. He must not be discounted for that.
    const ktcRedraft = shared(299, curve);
    const fcRedraft = [
      ...shared(199, (i) => Math.round(curve(i) * 1.4)),
      { playerId: "tuten", value: Math.round(curve(69) * 1.4) },
    ];
    const twoSource = new Map([
      ["ktc", ktcRedraft],
      ["fantasycalc", fcRedraft],
    ]);
    const ref = buildSyntheticReference({ bySource: twoSource, minShared: 100 })!;
    const result = calibrateSlice({
      bySource: twoSource,
      weights: WEIGHTS,
      band: BAND,
      minPlayers: 30,
      reference: ref.values,
    });

    const tuten = result.players.get("tuten")!;
    expect(tuten.coverage).toBe(1);
    expect(tuten.lowConfidence).toBe(true);
    // He is valued exactly where FantasyCalc's 69th-ranked player lands, which
    // is nowhere near the bottom of the board.
    const peer = result.players.get("p0069")!;
    const fcPeer = peer.contributions.find((c) => c.source === "fantasycalc")!.calibratedScaled!;
    expect(tuten.scaled).toBeCloseTo(fcPeer, 12);
    expect(tuten.value).toBeGreaterThan(2000);
  });
});

describe("calibrateSlice: stability when a source disappears", () => {
  const rnd = lcg(99);
  // Two sources that genuinely disagree, so dropping one is a real event rather
  // than a no-op. Each jitters the shared curve by up to +/- 25 percent.
  const jitter = (i: number, scale: number) =>
    Math.max(1, Math.round(curve(i) * scale * (0.75 + 0.5 * rnd())));
  const ktc = shared(299, (i) => jitter(i, 1));
  const fantasycalc = shared(199, (i) => jitter(i, 2.2));
  const bySource = new Map([
    ["ktc", ktc],
    ["fantasycalc", fantasycalc],
  ]);
  const reference = buildSyntheticReference({ bySource, minShared: 100 })!;
  const base = {
    weights: WEIGHTS,
    band: BAND,
    minPlayers: 30,
    reference: reference.values,
  };

  type Board = { players: Map<string, { value: number }> };
  const meanAbsMove = (a: Board, b: Board) => {
    const ids = [...a.players.keys()].filter((id) => b.players.has(id));
    const total = ids.reduce(
      (sum, id) => sum + Math.abs(b.players.get(id)!.value - a.players.get(id)!.value),
      0,
    );
    return total / ids.length;
  };

  it("still produces a valid board when either source drops", () => {
    for (const dropped of ["ktc", "fantasycalc"]) {
      const remaining = new Map(bySource);
      remaining.delete(dropped);
      const result = calibrateSlice({ ...base, bySource: remaining });
      expect(result.players.size).toBeGreaterThan(150);
      for (const p of result.players.values()) {
        expect(Number.isFinite(p.value)).toBe(true);
        expect(p.value).toBeGreaterThanOrEqual(0);
        expect(p.value).toBeLessThanOrEqual(10000);
      }
    }
  });

  it("moves the board less than 350 points on average when only one source is left", () => {
    const all = calibrateSlice({ ...base, bySource });
    for (const dropped of ["ktc", "fantasycalc"]) {
      const remaining = new Map(bySource);
      remaining.delete(dropped);
      const one = calibrateSlice({ ...base, bySource: remaining });
      expect(meanAbsMove(all, one)).toBeLessThan(350);
    }
  });

  it("beats the original method, which rescales against whoever is left", () => {
    const legacyAll = normalizeSlice({ bySource, weights: WEIGHTS, band: BAND, minPlayers: 30 });
    const remaining = new Map(bySource);
    remaining.delete("fantasycalc");
    const legacyOne = normalizeSlice({
      bySource: remaining,
      weights: WEIGHTS,
      band: BAND,
      minPlayers: 30,
    });
    const calibratedAll = calibrateSlice({ ...base, bySource });
    const calibratedOne = calibrateSlice({ ...base, bySource: remaining });
    expect(meanAbsMove(calibratedAll, calibratedOne)).toBeLessThan(
      meanAbsMove(legacyAll, legacyOne),
    );
  });
});

describe("existing blending behaviour is untouched", () => {
  // The calibrated value is a base input to combine() exactly like the
  // quantile_median value was. Ordering must stay: base -> factor (clamped) ->
  // overrides -> band clamp, with the band clamp last.
  it("applies the factor clamp, then overrides, then the band clamp", () => {
    const r = combine({
      baseInputs: [{ value: 5000, weight: 1 }],
      adjustInputs: [{ adjustmentPct: 10, weight: 1, confidence: 1 }], // wildly hot
      overrides: [{ type: "multiplier", magnitude: 3, silent: false }],
      band: { floor: 0, ceiling: 9000 },
      factorMin: 0.5,
      factorMax: 1.5,
    })!;
    expect(r.factor).toBe(1.5); // factor clamp bit
    expect(r.factorSaturated).toBe(true);
    expect(r.published).toBe(9000); // band clamp is last and wins
  });

  it("keeps formula_offset = published - market, which trends depend on", () => {
    const r = combine({
      baseInputs: [{ value: 4000, weight: 1 }],
      adjustInputs: [],
      overrides: [{ type: "delta", magnitude: 500, silent: true }],
      band: BAND,
      factorMin: 0.5,
      factorMax: 1.5,
    })!;
    expect(r.market).toBe(4000); // a silent override is invisible to trends
    expect(r.published).toBe(4500);
    expect(r.formulaOffset).toBe(r.published - r.market);
  });
});
