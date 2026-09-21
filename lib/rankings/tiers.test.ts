import { describe, expect, it } from "vitest";
import {
  assignPositionalTiers,
  steepestCliff,
  tierBands,
  type TierInput,
} from "@/lib/rankings/tiers";

/** The top 24 dynasty superflex running back values as of 2026-09-21, which is
 *  the shape the rule was calibrated against. Real numbers, so a change to the
 *  thresholds shows up here as a change to a board a reader could be looking
 *  at rather than as a change to an invented curve. */
const RB_VALUES = [
  9980, 9288, 7931, 7207, 6525, 6464, 6243, 6127, 5985, 5101, 5025, 4948, 4164,
  3831, 3670, 3637, 3581, 3568, 3529, 3451, 3235, 3171, 3142, 2751,
];

const rbRows: TierInput[] = RB_VALUES.map((value) => ({ position: "RB", value }));

describe("assignPositionalTiers", () => {
  it("opens a new tier at a real value cliff, not at a fixed interval", () => {
    const tiers = assignPositionalTiers(rbRows).map((t) => t.tier);
    // Robinson and Gibbs sit alone above a 1,357 point drop.
    expect(tiers[0]).toBe(1);
    expect(tiers[1]).toBe(1);
    expect(tiers[2]).toBe(2);
    // The next cliff is McCaffrey, 884 below Walker.
    expect(tiers[8]).toBe(2);
    expect(tiers[9]).toBe(3);
    // Then Barkley, 784 below Chase Brown.
    expect(tiers[11]).toBe(3);
    expect(tiers[12]).toBe(4);
  });

  it("marks only the first player of each tier as starting it", () => {
    const results = assignPositionalTiers(rbRows);
    expect(results[0].startsTier).toBe(true);
    expect(results[1].startsTier).toBe(false);
    expect(results[2].startsTier).toBe(true);
  });

  it("reports the gap to the next player at the same position", () => {
    const results = assignPositionalTiers(rbRows);
    expect(results[0].gapToNext).toBe(9980 - 9288);
    expect(results[0].gapToNextPct).toBeCloseTo((692 / 9980) * 100, 5);
    expect(results[RB_VALUES.length - 1].gapToNext).toBeNull();
  });

  it("tiers each position independently", () => {
    const rows: TierInput[] = [
      { position: "QB", value: 10000 },
      { position: "RB", value: 9980 },
      { position: "QB", value: 4000 },
      { position: "RB", value: 9288 },
    ];
    const results = assignPositionalTiers(rows);
    // The quarterbacks are 6,000 apart, so they are two tiers.
    expect(results[0].tier).toBe(1);
    expect(results[2].tier).toBe(2);
    // The running backs are 692 apart, which is under the step threshold.
    expect(results[1].tier).toBe(1);
    expect(results[3].tier).toBe(1);
    // A tier number is per position, so both positions start at 1.
    expect(results[0].tier).toBe(results[1].tier);
  });

  it("does not slice the tail of a board into one-man tiers", () => {
    // Twelve players scraping along at the bottom of a 10,000-point scale.
    // Every step here is a double-digit percentage and every one is tiny.
    const rows: TierInput[] = [
      { position: "WR", value: 10000 },
      ...[90, 80, 72, 64, 58, 52, 47, 42, 38, 34, 30].map((value) => ({
        position: "WR",
        value,
      })),
    ];
    const tiers = assignPositionalTiers(rows).map((t) => t.tier);
    // The star is his own tier; nothing below him splits again.
    expect(tiers[0]).toBe(1);
    expect(new Set(tiers.slice(1)).size).toBe(1);
    expect(tiers[1]).toBe(2);
  });

  it("still tiers a position whose whole range is small", () => {
    // Kickers run 242 down to 66. The absolute floor must not swallow them.
    const rows: TierInput[] = [242, 238, 235, 180, 176, 120].map((value) => ({
      position: "K",
      value,
    }));
    const tiers = assignPositionalTiers(rows).map((t) => t.tier);
    expect(tiers[0]).toBe(1);
    expect(tiers[2]).toBe(1);
    expect(tiers[3]).toBe(2);
    expect(tiers[5]).toBe(3);
  });

  it("closes a tier that runs long even with no cliff in it", () => {
    // Twenty players a quarter of a percent apart: no step and no span ever
    // qualifies, so only the size cap can end the tier.
    const rows: TierInput[] = Array.from({ length: 20 }, (_, i) => ({
      position: "TE",
      value: 5000 - i * 12,
    }));
    const results = assignPositionalTiers(rows);
    for (const r of results) {
      expect(r.tierSize).not.toBeNull();
      expect(r.tierSize as number).toBeLessThanOrEqual(12);
    }
    expect(results[19].tier).toBeGreaterThan(1);
  });

  it("leaves a player with no value untiered rather than guessing", () => {
    const rows: TierInput[] = [
      { position: "RB", value: 9980 },
      { position: "RB", value: null },
      { position: "RB", value: 9288 },
    ];
    const results = assignPositionalTiers(rows);
    expect(results[1]).toEqual({
      tier: null,
      tierSize: null,
      startsTier: false,
      gapToNext: null,
      gapToNextPct: null,
      opensNextTier: false,
    });
    // And the untiered player does not break the run either side of him.
    expect(results[0].tier).toBe(1);
    expect(results[2].tier).toBe(1);
  });

  it("splits a curve with no cliff in it evenly, not one player at a time", () => {
    // A constant-percentage decay: every step is the same 1.1% and no step
    // qualifies as a cliff, but the ABSOLUTE gaps shrink all the way down.
    // Scoring split candidates by absolute size made the topmost gap win
    // every pass, shaving one player off the head over and over and leaving
    // dozens of singleton tiers above one blob. Scored relatively they tie,
    // and the midpoint rule splits evenly.
    const rows: TierInput[] = Array.from({ length: 200 }, (_, i) => ({
      position: "WR",
      value: Math.round(10000 * Math.exp(-i / 90)),
    }));
    const results = assignPositionalTiers(rows);
    const tiers = results.map((r) => r.tier as number);
    const singletons = new Set(
      tiers.filter((t) => tiers.filter((x) => x === t).length === 1),
    ).size;
    expect(Math.max(...tiers)).toBeLessThan(40);
    expect(singletons).toBeLessThanOrEqual(1);
  });

  it("flags the row above a tier boundary, which is what the Gap column tones", () => {
    const results = assignPositionalTiers(rbRows);
    // Gibbs is the last of tier 1, so his gap is the drop into tier 2.
    expect(results[1].tier).toBe(1);
    expect(results[1].opensNextTier).toBe(true);
    // Robinson above him is inside tier 1, so his gap is not a boundary.
    expect(results[0].opensNextTier).toBe(false);
    // The last player on the board has no next player to fall to.
    expect(results[RB_VALUES.length - 1].opensNextTier).toBe(false);
  });

  it("honours the size cap even when a value is not a number", () => {
    // NaN loses every comparison, so the split scan used to find no candidate
    // and abandon the run at any length.
    const rows: TierInput[] = [
      { position: "TE", value: 100 },
      ...Array.from({ length: 30 }, () => ({
        position: "TE",
        value: Number.NaN,
      })),
    ];
    const results = assignPositionalTiers(rows);
    for (const r of results) {
      if (r.tierSize !== null) expect(r.tierSize).toBeLessThanOrEqual(12);
    }
    // The NaN rows are not tiered at all, the same as a missing value.
    expect(results[1].tier).toBeNull();
    expect(results[0].tier).toBe(1);
  });

  it("returns results in input order, not value order", () => {
    const rows: TierInput[] = [
      { position: "WR", value: 100 },
      { position: "WR", value: 10000 },
    ];
    const results = assignPositionalTiers(rows);
    expect(results[0].tier).toBe(2);
    expect(results[1].tier).toBe(1);
  });

  it("handles an empty board", () => {
    expect(assignPositionalTiers([])).toEqual([]);
  });
});

describe("tierBands", () => {
  it("rolls a position up into bands with the cliff between them", () => {
    const results = assignPositionalTiers(rbRows);
    const bands = tierBands(
      results.map((r, i) => ({ tier: r.tier, value: RB_VALUES[i] })),
    );
    expect(bands[0]).toMatchObject({ tier: 1, count: 2, topValue: 9980, bottomValue: 9288 });
    expect(bands[0].cliff).toBe(9288 - 7931);
    expect(bands[bands.length - 1].cliff).toBeNull();
  });

  it("ignores rows with no tier", () => {
    expect(tierBands([{ tier: null, value: 500 }, { tier: 1, value: 400 }])).toEqual([
      { tier: 1, count: 1, topValue: 400, bottomValue: 400, cliff: null },
    ]);
  });
});

describe("steepestCliff", () => {
  it("names the tier the biggest drop falls off", () => {
    const results = assignPositionalTiers(rbRows);
    const bands = tierBands(
      results.map((r, i) => ({ tier: r.tier, value: RB_VALUES[i] })),
    );
    expect(steepestCliff(bands)).toEqual({ tier: 1, drop: 9288 - 7931 });
  });

  it("is null when there is nothing to fall off", () => {
    expect(steepestCliff([])).toBeNull();
    expect(
      steepestCliff([{ tier: 1, count: 1, topValue: 1, bottomValue: 1, cliff: null }]),
    ).toBeNull();
  });

  it("refuses to call a drop of zero a cliff", () => {
    // The size cap can force a boundary between players on identical values;
    // the live receiver board has a run of twelve at 101. Reporting that as
    // the steepest cliff prints "the fall is 0 points of value, that is the
    // cliff worth reaching a round early for".
    expect(
      steepestCliff([
        { tier: 1, count: 12, topValue: 101, bottomValue: 101, cliff: 0 },
        { tier: 2, count: 4, topValue: 101, bottomValue: 90, cliff: null },
      ]),
    ).toBeNull();
  });
});
