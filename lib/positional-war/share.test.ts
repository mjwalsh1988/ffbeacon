/**
 * Coverage for E4 (cross-league Positional WAR compute sharing): the hit,
 * miss, and collision paths through resolveSharedCurves, and concurrent
 * upsert idempotence.
 *
 * The digest comparison itself (each of the nine WarInputsDigest fields
 * rejecting independently) is already covered by
 * lib/positional-war/fingerprint.test.ts's digestsMatch suite, so it is not
 * repeated here.
 *
 * The two tables this module touches directly (positional_war_curves,
 * league_positional_war_cache) are hand-built stubs recording every call, in
 * order, matching the pattern in lib/league-power-pulse.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSharedCurves } from "./share";
import type { WarInputsDigest } from "./fingerprint";
import type { PositionCurve } from "./types";

function fakeDigest(overrides: Partial<WarInputsDigest> = {}): WarInputsDigest {
  return {
    season: 2026,
    fromWeek: 9,
    toWeek: 14,
    teamCount: 12,
    slots: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF"],
    scoringBase: "pts_ppr",
    scoringUsable: true,
    scoringKeyCount: 41,
    projectionSource: "sleeper",
    modelVersion: "war-1",
    ...overrides,
  };
}

function fakeCurve(position: PositionCurve["position"], overrides: Partial<PositionCurve> = {}): PositionCurve {
  return {
    position,
    structuralDemand: 2,
    replacementPoints: 8.5,
    avgSeatedPoints: 12.1,
    deficit: 3.6,
    shallowPool: false,
    warRank1: 0.42,
    warAtDemand: 0.05,
    cliffRank: 4,
    curve: [
      {
        playerId: `${position}-1`,
        sleeperId: "1001",
        slug: `${position.toLowerCase()}-one`,
        name: `${position} One`,
        team: "TST",
        injuryStatus: null,
        positionRank: 1,
        war: 0.42,
        pointsAboveReplacement: 12.3,
        projectedPointsPerWeek: 20.8,
        replacementPointsPerWeek: 8.5,
        weeksProjected: 6,
      },
    ],
    weeklyDiagnostics: [
      { week: 9, seatedCount: 24, replacement: 8.5, avgSeated: 12.1, deficit: 3.6, muRef: 110, sigmaRef: 22 },
    ],
    ...overrides,
  };
}

type StoredSharedRow = {
  position: string;
  structural_demand: number;
  replacement_points: number | null;
  avg_seated_points: number | null;
  deficit: number | null;
  shallow_pool: boolean;
  war_rank_1: number | null;
  war_at_demand: number | null;
  cliff_rank: number | null;
  curve: unknown;
  weekly_diagnostics: unknown;
  from_week: number;
  through_week: number;
  model_version: string;
  inputs_digest: unknown;
};

/**
 * Minimal stand-in for positional_war_curves and league_positional_war_cache.
 * `sharedTable` is keyed by fingerprint so a test can pre-seed a "hit"
 * scenario, or leave it empty for a "miss". Records every operation in
 * `calls`, in call order.
 */
function makeFakeClient(opts: { sharedRows?: StoredSharedRow[] } = {}) {
  const calls: string[] = [];
  const sharedByFingerprint = new Map<string, StoredSharedRow[]>();
  if (opts.sharedRows && opts.sharedRows.length > 0) {
    sharedByFingerprint.set("fp-under-test", opts.sharedRows);
  }
  const cacheUpserts: Array<Record<string, unknown>[]> = [];
  const cachePruneFilters: string[] = [];
  const sharedUpserts: Array<Record<string, unknown>[]> = [];
  const sharedDeletes: string[] = [];

  const sharedBuilder = () => {
    let fingerprintFilter: string | null = null;
    const builder = {
      select: () => builder,
      eq: (col: string, value: string) => {
        if (col === "fingerprint") fingerprintFilter = value;
        return builder;
      },
      then: (resolve: (v: { data: StoredSharedRow[]; error: null }) => void) => {
        calls.push("shared.select");
        const rows = fingerprintFilter ? (sharedByFingerprint.get(fingerprintFilter) ?? []) : [];
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
      upsert: (rows: Record<string, unknown>[]) => {
        calls.push("shared.upsert");
        sharedUpserts.push(rows);
        sharedByFingerprint.set("fp-under-test", rows as unknown as StoredSharedRow[]);
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: (_col: string, value: string) => {
          calls.push("shared.delete");
          sharedDeletes.push(value);
          sharedByFingerprint.delete(value);
          return Promise.resolve({ error: null });
        },
      }),
    };
    return builder;
  };

  const cacheBuilder = () => ({
    upsert: (rows: Record<string, unknown>[]) => {
      calls.push("cache.upsert");
      cacheUpserts.push(rows);
      return Promise.resolve({ error: null });
    },
    // The prune that drops a position this league no longer starts. Chains
    // .eq().eq().not() and resolves, so the stub mirrors that shape and
    // records the position filter it was handed.
    delete: () => {
      calls.push("cache.delete");
      const chain = {
        eq: () => chain,
        not: (_column: string, _operator: string, value: string) => {
          cachePruneFilters.push(value);
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  });

  const client = {
    from: (table: string) => {
      if (table === "positional_war_curves") return sharedBuilder();
      if (table === "league_positional_war_cache") return cacheBuilder();
      throw new Error(`unexpected table in test stub: ${table}`);
    },
  };

  return {
    client: client as never,
    calls,
    cacheUpserts,
    sharedUpserts,
    sharedDeletes,
    cachePruneFilters,
  };
}

const BASE_PARAMS = {
  leagueRowId: "league-row-1",
  season: 2026,
  fingerprint: "fp-under-test",
  fromWeek: 9,
  toWeek: 14,
  modelVersion: "war-1",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a position the league stopped starting", () => {
  it("is pruned from the per-league cache rather than left to render forever", async () => {
    // A commissioner drops the DEF slot mid-season. startingSlots() changes,
    // so the fingerprint changes, so a fresh computation runs and returns one
    // fewer position. The upsert only ever writes the positions it was given,
    // and loadPositionalWarView reads every row for the league season with no
    // fingerprint filter, so without the prune the stale DEF series would keep
    // rendering on the chart, the rail and the shared card, computed under
    // settings that no longer describe the league.
    const { client, calls, cachePruneFilters } = makeFakeClient();
    const compute = vi.fn().mockResolvedValue([fakeCurve("QB"), fakeCurve("RB")]);

    const result = await resolveSharedCurves(client, {
      ...BASE_PARAMS,
      digest: fakeDigest(),
      compute,
    });

    expect(result.ok).toBe(true);
    expect(calls).toContain("cache.delete");
    // Scoped to the positions this run did NOT write, so it can never remove a
    // row the same run just committed.
    expect(cachePruneFilters).toEqual(["(QB,RB)"]);
    // And it happens after the write, not before, so a failed upsert never
    // leaves the league with nothing.
    expect(calls.indexOf("cache.upsert")).toBeLessThan(calls.indexOf("cache.delete"));
  });
});

describe("resolveSharedCurves: miss", () => {
  it("computes fresh, upserts the shared row, and writes the league cache", async () => {
    const { client, calls, cacheUpserts, sharedUpserts } = makeFakeClient();
    const compute = vi.fn().mockResolvedValue([fakeCurve("QB"), fakeCurve("RB")]);

    const result = await resolveSharedCurves(client, {
      ...BASE_PARAMS,
      digest: fakeDigest(),
      compute,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shared).toBe(false);
    expect(result.collision).toBe(false);
    expect(result.curves).toHaveLength(2);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(sharedUpserts).toHaveLength(1);
    expect(sharedUpserts[0]).toHaveLength(2);
    expect(cacheUpserts).toHaveLength(1);
    expect(calls.indexOf("shared.select")).toBeLessThan(calls.indexOf("shared.upsert"));
    expect(calls.indexOf("shared.upsert")).toBeLessThan(calls.indexOf("cache.upsert"));
  });

  it("writes nothing to either table when compute returns no curves", async () => {
    const { cacheUpserts, sharedUpserts, client } = makeFakeClient();
    const compute = vi.fn().mockResolvedValue([]);

    const result = await resolveSharedCurves(client, {
      ...BASE_PARAMS,
      digest: fakeDigest(),
      compute,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.curves).toEqual([]);
    expect(result.shared).toBe(false);
    expect(sharedUpserts).toHaveLength(0);
    expect(cacheUpserts).toHaveLength(0);
  });
});

describe("resolveSharedCurves: hit", () => {
  it("copies the stored curve without calling compute", async () => {
    const digest = fakeDigest();
    const storedRows: StoredSharedRow[] = [
      { ...toStoredRow(fakeCurve("QB")), inputs_digest: digest },
      { ...toStoredRow(fakeCurve("RB")), inputs_digest: digest },
    ];
    const { client, calls, cacheUpserts, sharedUpserts } = makeFakeClient({ sharedRows: storedRows });
    const compute = vi.fn().mockResolvedValue([fakeCurve("QB")]);

    const result = await resolveSharedCurves(client, {
      ...BASE_PARAMS,
      digest,
      compute,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shared).toBe(true);
    expect(result.collision).toBe(false);
    expect(result.curves).toHaveLength(2);
    expect(compute).not.toHaveBeenCalled();
    expect(sharedUpserts).toHaveLength(0); // positional_war_curves untouched on a hit
    expect(cacheUpserts).toHaveLength(1); // only the per-league copy happens
    expect(calls).not.toContain("shared.delete");
  });

  it("E4-1: two leagues with identical fingerprints produce byte-identical curves without a second compute", async () => {
    const digest = fakeDigest();
    const curve = fakeCurve("WR");
    const storedRows: StoredSharedRow[] = [{ ...toStoredRow(curve), inputs_digest: digest }];
    const { client } = makeFakeClient({ sharedRows: storedRows });
    const compute = vi.fn().mockResolvedValue([curve]);

    const first = await resolveSharedCurves(client, { ...BASE_PARAMS, digest, compute });
    const second = await resolveSharedCurves(client, { ...BASE_PARAMS, digest, compute });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.curves).toEqual(second.curves);
    expect(compute).not.toHaveBeenCalled();
  });
});

describe("resolveSharedCurves: collision (E4-2)", () => {
  it("logs an error, deletes the colliding rows, and recomputes fresh on a digest mismatch", async () => {
    const storedDigest = fakeDigest({ teamCount: 10 });
    const requestedDigest = fakeDigest({ teamCount: 12 });
    const storedRows: StoredSharedRow[] = [{ ...toStoredRow(fakeCurve("QB")), inputs_digest: storedDigest }];
    const { client, calls, sharedDeletes, sharedUpserts, cacheUpserts } = makeFakeClient({
      sharedRows: storedRows,
    });
    const freshCurve = fakeCurve("QB", { warRank1: 0.99 });
    const compute = vi.fn().mockResolvedValue([freshCurve]);

    const result = await resolveSharedCurves(client, {
      ...BASE_PARAMS,
      digest: requestedDigest,
      compute,
    });

    expect(console.error).toHaveBeenCalled();
    const [message] = vi.mocked(console.error).mock.calls[0];
    expect(String(message)).toContain("teamCount");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.collision).toBe(true);
    expect(result.shared).toBe(false);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(sharedDeletes).toContain(BASE_PARAMS.fingerprint);
    expect(sharedUpserts).toHaveLength(1);
    expect(cacheUpserts).toHaveLength(1);
    expect(calls.indexOf("shared.delete")).toBeLessThan(calls.indexOf("shared.upsert"));
  });
});

describe("resolveSharedCurves: concurrent upsert idempotence", () => {
  it("a second miss for the same fingerprint overwrites harmlessly with identical data", async () => {
    const { client, sharedUpserts, cacheUpserts } = makeFakeClient();
    const digest = fakeDigest();
    const curves = [fakeCurve("QB")];
    const compute = vi.fn().mockResolvedValue(curves);

    const [first, second] = await Promise.all([
      resolveSharedCurves(client, { ...BASE_PARAMS, digest, compute }),
      resolveSharedCurves(client, { ...BASE_PARAMS, digest, compute }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // Both raced past the (empty) read and both computed and upserted; no
    // throw, and the two upserts carry the same deterministic data.
    //
    // `computed_at` is excluded because it is a clock read, not model output.
    // The two calls stamp it independently, so asserting they match is
    // asserting that two Date.now() calls landed in the same millisecond,
    // which is true almost always and flakes the rest of the time. What the
    // test is actually about is that a concurrent second miss overwrites with
    // the same CURVE data, so the row a reader ends up with does not depend on
    // which writer won.
    expect(sharedUpserts).toHaveLength(2);
    expect(withoutTimestamps(sharedUpserts[0])).toEqual(withoutTimestamps(sharedUpserts[1]));
    for (const rows of sharedUpserts) {
      for (const row of rows as Array<{ computed_at?: string }>) {
        expect(Number.isNaN(Date.parse(String(row.computed_at)))).toBe(false);
      }
    }
    expect(cacheUpserts).toHaveLength(2);
  });
});

/** Convert a PositionCurve into the shape a stored positional_war_curves row would carry. */
function toStoredRow(c: PositionCurve): StoredSharedRow {
  return {
    position: c.position,
    structural_demand: c.structuralDemand,
    replacement_points: c.replacementPoints,
    avg_seated_points: c.avgSeatedPoints,
    deficit: c.deficit,
    shallow_pool: c.shallowPool,
    war_rank_1: c.warRank1,
    war_at_demand: c.warAtDemand,
    cliff_rank: c.cliffRank,
    curve: c.curve,
    weekly_diagnostics: c.weeklyDiagnostics,
    from_week: BASE_PARAMS.fromWeek,
    through_week: BASE_PARAMS.toWeek,
    model_version: BASE_PARAMS.modelVersion,
    inputs_digest: fakeDigest(),
  };
}

/**
 * A copy of an upsert payload with every clock-read column dropped, so two
 * independently stamped writes can be compared on the data they actually
 * carry.
 */
function withoutTimestamps(rows: unknown): unknown {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    const copy = { ...(row as Record<string, unknown>) };
    delete copy.computed_at;
    delete copy.generated_at;
    return copy;
  });
}
