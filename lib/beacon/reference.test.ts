import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import {
  assessSourceCompleteness,
  buildReferenceCandidate,
  compareBoards,
  evaluateDriftAlerts,
  expectedSourcesFor,
  loadActiveReferences,
  persistReference,
  ReferenceBuildError,
  ReferenceLoadError,
  referenceAgeDays,
  spearman,
  driftAlertStreak,
  type DriftAlertSettings,
} from "./reference";
import { resolveDriftThresholds } from "./settings";
import { buildSyntheticReference } from "./calibrate";
import { parseFormatSlugList, resolveNormalizationMethod } from "./settings";
import type { SourcePlayerValue } from "./normalize";

// ---------------------------------------------------------------------------
// A minimal fake PostgREST client. Every test scripts exactly the responses it
// needs and can then assert on what was called, which is how the "never
// rebuilds, never writes" guarantees are checked rather than assumed.
// ---------------------------------------------------------------------------

interface FakeCall {
  table: string;
  op: "select" | "insert" | "update" | "rpc";
  payload?: unknown;
  filters: Record<string, unknown>;
  range?: [number, number];
}
type FakeResponse = { data: unknown; error: unknown };
type FakeHandler = (call: FakeCall) => FakeResponse;

class FakeBuilder implements PromiseLike<FakeResponse> {
  constructor(
    private readonly call: FakeCall,
    private readonly handler: FakeHandler,
  ) {}
  select() {
    return this;
  }
  eq(col: string, value: unknown) {
    this.call.filters[col] = value;
    return this;
  }
  in(col: string, value: unknown) {
    this.call.filters[col] = value;
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  range(from: number, to: number) {
    this.call.range = [from, to];
    return this;
  }
  single() {
    return Promise.resolve(this.handler(this.call));
  }
  maybeSingle() {
    return Promise.resolve(this.handler(this.call));
  }
  then<A, B>(
    onOk?: ((r: FakeResponse) => A | PromiseLike<A>) | null,
    onErr?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.handler(this.call)).then(onOk, onErr);
  }
}

class FakeClient {
  readonly calls: FakeCall[] = [];
  constructor(private readonly handler: FakeHandler) {}
  private record(call: FakeCall) {
    this.calls.push(call);
    return new FakeBuilder(call, this.handler);
  }
  from(table: string) {
    const self = this;
    return {
      select: () => self.record({ table, op: "select", filters: {} }),
      insert: (payload: unknown) => self.record({ table, op: "insert", payload, filters: {} }),
      update: (payload: unknown) => self.record({ table, op: "update", payload, filters: {} }),
    };
  }
  rpc(name: string, args: unknown) {
    return this.record({ table: name, op: "rpc", payload: args, filters: {} });
  }
  as() {
    return this as unknown as SupabaseClient<Database>;
  }
}

const FORMAT = "11111111-1111-1111-1111-111111111111";
const VERSION = "22222222-2222-2222-2222-222222222222";

function activeVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION,
    format_config_id: FORMAT,
    version: 3,
    generated_at: "2026-07-01T00:00:00.000Z",
    activated_at: "2026-07-01T00:05:00.000Z",
    shared_player_count: 3,
    expected_sources: ["fantasycalc", "ktc"],
    diagnostics: {},
    ...overrides,
  };
}

const REFERENCE_ROWS = [
  { player_id: "a", reference_scaled: 1 },
  { player_id: "b", reference_scaled: 0.6 },
  { player_id: "c", reference_scaled: 0.2 },
];

describe("loadActiveReferences", () => {
  it("loads and validates the active reference", async () => {
    const client = new FakeClient((call) =>
      call.table === "beacon_reference_versions"
        ? { data: [activeVersionRow()], error: null }
        : { data: call.range?.[0] === 0 ? REFERENCE_ROWS : [], error: null },
    );
    const out = await loadActiveReferences(client.as(), [FORMAT]);
    const ref = out.get(FORMAT)!;
    expect(ref.version).toBe(3);
    expect(ref.values.get("a")).toBe(1);
    expect(ref.values.size).toBe(3);
  });

  it("treats a clean empty result as a cold start, not a failure", async () => {
    const client = new FakeClient(() => ({ data: [], error: null }));
    const out = await loadActiveReferences(client.as(), [FORMAT]);
    expect(out.get(FORMAT)).toBeNull();
    // Nothing was written. A cold start is reported, never repaired in place.
    expect(client.calls.some((c) => c.op === "insert" || c.op === "update")).toBe(false);
  });

  it("throws on a query error instead of rebuilding or falling back", async () => {
    const client = new FakeClient(() => ({
      data: null,
      error: { message: "permission denied for table beacon_reference_versions" },
    }));
    await expect(loadActiveReferences(client.as(), [FORMAT])).rejects.toBeInstanceOf(
      ReferenceLoadError,
    );
    expect(client.calls.some((c) => c.op === "insert" || c.op === "update")).toBe(false);
    expect(client.calls.some((c) => c.op === "rpc")).toBe(false);
  });

  it("throws when the persisted rows disagree with the version header", async () => {
    const client = new FakeClient((call) =>
      call.table === "beacon_reference_versions"
        ? { data: [activeVersionRow({ shared_player_count: 400 })], error: null }
        : { data: call.range?.[0] === 0 ? REFERENCE_ROWS : [], error: null },
    );
    await expect(loadActiveReferences(client.as(), [FORMAT])).rejects.toThrow(/incomplete/i);
  });

  it("throws when a stored value is outside [0,1]", async () => {
    const client = new FakeClient((call) =>
      call.table === "beacon_reference_versions"
        ? { data: [activeVersionRow()], error: null }
        : {
            data:
              call.range?.[0] === 0
                ? [...REFERENCE_ROWS.slice(0, 2), { player_id: "c", reference_scaled: 4.2 }]
                : [],
            error: null,
          },
    );
    await expect(loadActiveReferences(client.as(), [FORMAT])).rejects.toThrow(/out-of-range/i);
  });

  it("throws when the row read itself fails", async () => {
    const client = new FakeClient((call) =>
      call.table === "beacon_reference_versions"
        ? { data: [activeVersionRow()], error: null }
        : { data: null, error: { message: "relation does not exist" } },
    );
    await expect(loadActiveReferences(client.as(), [FORMAT])).rejects.toBeInstanceOf(
      ReferenceLoadError,
    );
  });
});

describe("expected sources", () => {
  const sources = [
    { slug: "ktc", supportedFormatSlugs: null },
    { slug: "fantasycalc", supportedFormatSlugs: ["redraft-ppr-std", "dynasty-ppr-sflex"] },
    { slug: "dynastyprocess", supportedFormatSlugs: ["dynasty-ppr-sflex", "dynasty-ppr-std"] },
    { slug: "ffbeacon", supportedFormatSlugs: null },
  ];

  it("does not expect DynastyProcess on a redraft board it does not cover", () => {
    expect(expectedSourcesFor("redraft-ppr-std", sources)).toEqual(["fantasycalc", "ktc"]);
  });

  it("expects all three on dynasty superflex", () => {
    expect(expectedSourcesFor("dynasty-ppr-sflex", sources)).toEqual([
      "dynastyprocess",
      "fantasycalc",
      "ktc",
    ]);
  });

  it("never expects FF Beacon's own output", () => {
    expect(expectedSourcesFor("dynasty-ppr-std", sources)).not.toContain("ffbeacon");
  });

  it("reports a source that is absent or stale as missing", () => {
    const bySource = new Map<string, SourcePlayerValue[]>([
      ["ktc", [{ playerId: "a", value: 1 }]],
      ["fantasycalc", []],
    ]);
    const c = assessSourceCompleteness(["ktc", "fantasycalc", "dynastyprocess"], bySource);
    expect(c.ok).toBe(false);
    expect(c.missing).toEqual(["dynastyprocess", "fantasycalc"]);
  });
});

describe("buildReferenceCandidate", () => {
  const pool = (n: number, scale: number): SourcePlayerValue[] =>
    Array.from({ length: n }, (_, i) => ({
      playerId: `p${String(i).padStart(4, "0")}`,
      value: Math.round(10000 * Math.exp(-i / 120) * scale + 5),
    }));

  it("builds when every expected source is present", () => {
    const candidate = buildReferenceCandidate({
      formatConfigId: FORMAT,
      formatSlug: "dynasty-ppr-sflex",
      bySource: new Map([
        ["ktc", pool(400, 1)],
        ["fantasycalc", pool(300, 2)],
      ]),
      expected: ["fantasycalc", "ktc"],
      minShared: 100,
    });
    expect(candidate.reference.sharedPlayers.length).toBe(300);
    expect(candidate.completeness.ok).toBe(true);
  });

  it("refuses to build while an expected source is missing or stale", () => {
    expect(() =>
      buildReferenceCandidate({
        formatConfigId: FORMAT,
        formatSlug: "dynasty-ppr-sflex",
        bySource: new Map([["ktc", pool(400, 1)]]),
        expected: ["dynastyprocess", "fantasycalc", "ktc"],
        minShared: 100,
      }),
    ).toThrow(ReferenceBuildError);
  });

  it("refuses to build from a thin shared set", () => {
    expect(() =>
      buildReferenceCandidate({
        formatConfigId: FORMAT,
        formatSlug: "dynasty-ppr-sflex",
        bySource: new Map([
          ["ktc", pool(400, 1)],
          ["fantasycalc", pool(60, 2)],
        ]),
        expected: ["fantasycalc", "ktc"],
        minShared: 100,
      }),
    ).toThrow(/fewer than 100/);
  });
});

describe("persistReference", () => {
  const candidate = {
    formatConfigId: FORMAT,
    formatSlug: "dynasty-ppr-sflex",
    completeness: { ok: true, expected: ["fantasycalc", "ktc"], present: ["fantasycalc", "ktc"], missing: [] },
    reference: buildSyntheticReference({
      bySource: new Map([
        [
          "ktc",
          Array.from({ length: 150 }, (_, i) => ({ playerId: `p${i}`, value: 1000 - i })),
        ],
        [
          "fantasycalc",
          Array.from({ length: 150 }, (_, i) => ({ playerId: `p${i}`, value: 2000 - 2 * i })),
        ],
      ]),
      minShared: 100,
    })!,
  };

  it("writes the header, then the rows, then activates", async () => {
    const client = new FakeClient((call) => {
      if (call.op === "select") return { data: [], error: null };
      if (call.op === "insert" && call.table === "beacon_reference_versions") {
        return { data: { id: VERSION }, error: null };
      }
      return { data: null, error: null };
    });
    const res = await persistReference(client.as(), candidate, { minShared: 100 });
    expect(res.version).toBe(1);
    expect(res.players).toBe(150);

    const order = client.calls.map((c) => `${c.op}:${c.table}`);
    expect(order).toContain("insert:beacon_reference_versions");
    expect(order).toContain("insert:beacon_value_references");
    expect(order).toContain("rpc:activate_beacon_reference");
    expect(order.indexOf("insert:beacon_value_references")).toBeGreaterThan(
      order.indexOf("insert:beacon_reference_versions"),
    );
    expect(order.indexOf("rpc:activate_beacon_reference")).toBeGreaterThan(
      order.indexOf("insert:beacon_value_references"),
    );
    // The header goes in as a candidate. Only the RPC can make it live.
    const header = client.calls.find(
      (c) => c.op === "insert" && c.table === "beacon_reference_versions",
    )!;
    expect((header.payload as { status: string }).status).toBe("candidate");
  });

  it("leaves a failed candidate inert when the row write fails", async () => {
    const client = new FakeClient((call) => {
      if (call.op === "select") return { data: [], error: null };
      if (call.op === "insert" && call.table === "beacon_reference_versions") {
        return { data: { id: VERSION }, error: null };
      }
      if (call.op === "insert" && call.table === "beacon_value_references") {
        return { data: null, error: { message: "duplicate key value violates unique constraint" } };
      }
      return { data: null, error: null };
    });
    await expect(persistReference(client.as(), candidate, { minShared: 100 })).rejects.toBeInstanceOf(
      ReferenceBuildError,
    );
    // Never activated, and the half-written candidate is marked failed so it can
    // never be mistaken for a usable version.
    expect(client.calls.some((c) => c.op === "rpc")).toBe(false);
    const marked = client.calls.find(
      (c) => c.op === "update" && c.table === "beacon_reference_versions",
    );
    expect((marked?.payload as { status: string }).status).toBe("failed");
  });

  it("does not activate when the database refuses the version", async () => {
    const client = new FakeClient((call) => {
      if (call.op === "select") return { data: [], error: null };
      if (call.op === "insert" && call.table === "beacon_reference_versions") {
        return { data: { id: VERSION }, error: null };
      }
      if (call.op === "rpc") {
        return { data: null, error: { message: "Reference version is incomplete: 12 rows persisted, 150 declared" } };
      }
      return { data: null, error: null };
    });
    await expect(persistReference(client.as(), candidate, { minShared: 100 })).rejects.toThrow(
      /incomplete/,
    );
    const marked = client.calls.find(
      (c) => c.op === "update" && c.table === "beacon_reference_versions",
    );
    expect((marked?.payload as { status: string }).status).toBe("failed");
  });

  it("numbers the new version one past the highest existing one", async () => {
    const client = new FakeClient((call) => {
      if (call.op === "select") return { data: [{ version: 7 }], error: null };
      if (call.op === "insert" && call.table === "beacon_reference_versions") {
        return { data: { id: VERSION }, error: null };
      }
      return { data: null, error: null };
    });
    const res = await persistReference(client.as(), candidate, { minShared: 100 });
    expect(res.version).toBe(8);
  });
});

describe("drift alerts", () => {
  const settings: DriftAlertSettings = {
    calibrationMaxAgeDays: 45,
    calibrationMinSharedPlayers: 100,
    calibrationDriftMeanAbs: 100,
    calibrationDriftPlayerMax: 500,
    calibrationDriftPct250: 0.02,
    calibrationDriftMinSpearman: 0.995,
  };
  const calm = {
    players: 600,
    meanAbs: 30,
    maxMove: 200,
    over250: 0,
    over500: 0,
    pctOver250: 0,
    spearman: 0.999,
  };

  it("stays quiet when everything is inside the limits", () => {
    expect(
      evaluateDriftAlerts({ ageDays: 12, sharedPlayerCount: 380, metrics: calm }, settings),
    ).toEqual([]);
  });

  it("fires on an over-age reference", () => {
    const a = evaluateDriftAlerts({ ageDays: 46, sharedPlayerCount: 380, metrics: calm }, settings);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/days old/);
  });

  it("fires on a thin reference basis", () => {
    const a = evaluateDriftAlerts({ ageDays: 5, sharedPlayerCount: 99, metrics: calm }, settings);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/below the 100 minimum/);
  });

  it("fires on mean movement", () => {
    const a = evaluateDriftAlerts(
      { ageDays: 5, sharedPlayerCount: 380, metrics: { ...calm, meanAbs: 101 } },
      settings,
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/average player/);
  });

  it("fires when any single player would move 500 or more", () => {
    const a = evaluateDriftAlerts(
      { ageDays: 5, sharedPlayerCount: 380, metrics: { ...calm, maxMove: 500, over500: 1 } },
      settings,
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/500 points or more/);
  });

  it("fires when too much of the board would move 250 or more", () => {
    const a = evaluateDriftAlerts(
      { ageDays: 5, sharedPlayerCount: 380, metrics: { ...calm, over250: 20, pctOver250: 0.033 } },
      settings,
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/percent of the board/);
  });

  it("fires when board order would come apart", () => {
    const a = evaluateDriftAlerts(
      { ageDays: 5, sharedPlayerCount: 380, metrics: { ...calm, spearman: 0.99 } },
      settings,
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/order correlation/);
  });

  it("reports every breach at once rather than stopping at the first", () => {
    const a = evaluateDriftAlerts(
      {
        ageDays: 60,
        sharedPlayerCount: 40,
        metrics: { ...calm, meanAbs: 400, maxMove: 900, over500: 5, pctOver250: 0.5, spearman: 0.8 },
      },
      settings,
    );
    expect(a).toHaveLength(6);
  });
});

describe("resolveDriftThresholds", () => {
  const settings = {
    calibrationMaxAgeDays: 45,
    calibrationMinSharedPlayers: 100,
    calibrationDriftMeanAbs: 100,
    calibrationDriftPlayerMax: 500,
    calibrationDriftPct250: 0.02,
    calibrationDriftMinSpearman: 0.993,
    calibrationDriftRedraftMeanAbs: 120,
    calibrationDriftRedraftPlayerMax: 700,
    calibrationDriftRedraftPct250: 0.08,
    calibrationDriftRedraftMinSpearman: 0.992,
  };

  it("gives a redraft board the wider limits", () => {
    const t = resolveDriftThresholds("redraft", settings);
    expect(t.calibrationDriftPlayerMax).toBe(700);
    expect(t.calibrationDriftPct250).toBe(0.08);
  });

  it("gives a dynasty board the tight ones", () => {
    const t = resolveDriftThresholds("dynasty", settings);
    expect(t.calibrationDriftPlayerMax).toBe(500);
    expect(t.calibrationDriftPct250).toBe(0.02);
  });

  it("falls to the tight set on an unclassified board", () => {
    // Over-reporting about a board nobody has characterised is the safe
    // direction; going quiet about one is not.
    expect(resolveDriftThresholds(null, settings).calibrationDriftPlayerMax).toBe(500);
    expect(resolveDriftThresholds("keeper", settings).calibrationDriftPct250).toBe(0.02);
  });

  it("keeps age and thinness the same either way, since neither is movement", () => {
    for (const type of ["dynasty", "redraft"]) {
      const t = resolveDriftThresholds(type, settings);
      expect(t.calibrationMaxAgeDays).toBe(45);
      expect(t.calibrationMinSharedPlayers).toBe(100);
    }
  });

  it("separates the two boards that actually disagreed in production", () => {
    // redraft-ppr-sflex on 2026-08-24: one player moving 516, 7.8 percent of the
    // board moving 250+. An ordinary preseason night for a one-year board, and
    // it emailed, because it was being judged by dynasty numbers.
    const ordinaryRedraftNight = {
      players: 320,
      meanAbs: 68.8,
      maxMove: 516,
      over250: 25,
      over500: 1,
      pctOver250: 0.078,
      spearman: 0.99945,
    };
    expect(
      evaluateDriftAlerts(
        { ageDays: 23, sharedPlayerCount: 181, metrics: ordinaryRedraftNight },
        resolveDriftThresholds("redraft", settings),
      ),
    ).toEqual([]);
    expect(
      evaluateDriftAlerts(
        { ageDays: 23, sharedPlayerCount: 181, metrics: ordinaryRedraftNight },
        resolveDriftThresholds("dynasty", settings),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("still reports the redraft night that was genuinely out of range", () => {
    // 2026-08-22, the middle of the three-night run: 10.0 percent of the board
    // moving 250+. Widening the limits must not have swallowed this one, because
    // this is the run the whole change is meant to preserve.
    const outOfRange = {
      players: 320,
      meanAbs: 74,
      maxMove: 542,
      over250: 32,
      over500: 4,
      pctOver250: 0.1,
      spearman: 0.99926,
    };
    const alerts = evaluateDriftAlerts(
      { ageDays: 21, sharedPlayerCount: 181, metrics: outOfRange },
      resolveDriftThresholds("redraft", settings),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("250 points or more");
  });

  it("clears the dynasty rank-correlation trips that were inside the noise", () => {
    // Dynasty tripped the old 0.995 limit four times at 0.9942 to 0.9948 while
    // moving the average player 26 points. Nothing was wrong; the limit was.
    const dynastyNoise = {
      players: 780,
      meanAbs: 26,
      maxMove: 148,
      over250: 0,
      over500: 0,
      pctOver250: 0,
      spearman: 0.9942,
    };
    expect(
      evaluateDriftAlerts(
        { ageDays: 22, sharedPlayerCount: 387, metrics: dynastyNoise },
        resolveDriftThresholds("dynasty", settings),
      ),
    ).toEqual([]);
  });

  it("still reports a dynasty board that genuinely reorders", () => {
    // Widening redraft must not have made dynasty unalarmable.
    const broken = {
      players: 600,
      meanAbs: 30,
      maxMove: 900,
      over250: 40,
      over500: 12,
      pctOver250: 0.07,
      spearman: 0.96,
    };
    const alerts = evaluateDriftAlerts(
      { ageDays: 12, sharedPlayerCount: 380, metrics: broken },
      resolveDriftThresholds("dynasty", settings),
    );
    expect(alerts.length).toBeGreaterThanOrEqual(3);
  });
});

describe("driftAlertStreak", () => {
  const run = (...slugs: string[]) => new Set(slugs);

  it("is zero when tonight is clean, however bad last week was", () => {
    // A streak is about what is happening now. A board that tripped yesterday
    // and is fine today has nothing to report.
    expect(driftAlertStreak("redraft-ppr-std", false, [run("redraft-ppr-std")])).toBe(0);
  });

  it("counts tonight alone when there is no history", () => {
    expect(driftAlertStreak("redraft-ppr-std", true, [])).toBe(1);
  });

  it("counts consecutive runs and stops at the first clean one", () => {
    const history = [
      run("redraft-ppr-std"),
      run("redraft-ppr-std", "dynasty-ppr-sflex"),
      run("dynasty-ppr-sflex"),
      run("redraft-ppr-std"),
    ];
    expect(driftAlertStreak("redraft-ppr-std", true, history)).toBe(3);
  });

  it("does not credit another board's streak", () => {
    const history = [run("redraft-ppr-sflex"), run("redraft-ppr-sflex")];
    expect(driftAlertStreak("redraft-ppr-std", true, history)).toBe(1);
  });

  it("reproduces the three-night run that should still email", () => {
    // 2026-08-21, 22 and 23 on redraft-ppr-sflex: 9.4, 10.0 and 8.7 percent of
    // the board moving 250+. Three checks running, so it clears a streak of 3.
    const history = [run("redraft-ppr-sflex"), run("redraft-ppr-sflex")];
    expect(driftAlertStreak("redraft-ppr-sflex", true, history)).toBeGreaterThanOrEqual(3);
  });

  it("holds back the isolated spikes that made up most of the noise", () => {
    // 2026-08-13 on redraft-ppr-std: one player moving 532, clean the night
    // before and the night after. One of thirteen emails that should not have
    // been sent.
    expect(driftAlertStreak("redraft-ppr-std", true, [run("dynasty-ppr-sflex"), run()])).toBe(1);
  });
});

describe("board comparison helpers", () => {
  it("measures movement between two boards", () => {
    const before = new Map([
      ["a", { value: 1000 }],
      ["b", { value: 500 }],
      ["c", { value: 100 }],
    ]);
    const after = new Map([
      ["a", { value: 1300 }],
      ["b", { value: 500 }],
      ["c", { value: 100 }],
    ]);
    const m = compareBoards(before, after);
    expect(m.players).toBe(3);
    expect(m.meanAbs).toBeCloseTo(100, 9);
    expect(m.maxMove).toBe(300);
    expect(m.over250).toBe(1);
    expect(m.over500).toBe(0);
  });

  it("scores an unchanged ordering at 1", () => {
    expect(spearman([3, 2, 1], [30, 20, 10])).toBeCloseTo(1, 12);
  });

  it("scores a reversed ordering at -1", () => {
    expect(spearman([1, 2, 3], [30, 20, 10])).toBeCloseTo(-1, 12);
  });

  it("measures age in days", () => {
    const now = Date.UTC(2026, 6, 31);
    expect(referenceAgeDays(new Date(Date.UTC(2026, 6, 1)).toISOString(), now)).toBeCloseTo(30, 6);
  });
});

describe("rollout and rollback controls", () => {
  const base = { normalizationMethod: "quantile_median", calibrationFormatSlugs: [] as string[] };

  it("leaves every format on the original method by default", () => {
    expect(resolveNormalizationMethod("dynasty-ppr-sflex", base)).toBe("quantile_median");
    expect(resolveNormalizationMethod("redraft-ppr-std", base)).toBe("quantile_median");
  });

  it("switches exactly one format when it is on the canary list", () => {
    const canary = { ...base, calibrationFormatSlugs: ["dynasty-ppr-sflex"] };
    expect(resolveNormalizationMethod("dynasty-ppr-sflex", canary)).toBe("calibrated");
    expect(resolveNormalizationMethod("redraft-ppr-std", canary)).toBe("quantile_median");
  });

  it("switches everything when the global method is calibrated", () => {
    const global = { ...base, normalizationMethod: "calibrated" };
    expect(resolveNormalizationMethod("dynasty-ppr-sflex", global)).toBe("calibrated");
    expect(resolveNormalizationMethod("redraft-ppr-std", global)).toBe("calibrated");
  });

  it("rolls back with one setting, needing no code or data change", () => {
    const live = { normalizationMethod: "calibrated", calibrationFormatSlugs: ["dynasty-ppr-sflex"] };
    const rolledBack = { normalizationMethod: "quantile_median", calibrationFormatSlugs: [] };
    expect(resolveNormalizationMethod("dynasty-ppr-sflex", live)).toBe("calibrated");
    expect(resolveNormalizationMethod("dynasty-ppr-sflex", rolledBack)).toBe("quantile_median");
  });

  it("parses the canary list forgivingly", () => {
    expect(parseFormatSlugList(" dynasty-ppr-sflex , , redraft-ppr-std ")).toEqual([
      "dynasty-ppr-sflex",
      "redraft-ppr-std",
    ]);
    expect(parseFormatSlugList("")).toEqual([]);
    expect(parseFormatSlugList(null)).toEqual([]);
  });
});

describe("K and DEF stay on the original normalization", () => {
  // A structural guard rather than a behavioural one: the K/DEF pools need a
  // live database to exercise, but the thing that must not regress is a single
  // call site. If someone later routes them through the calibrated path, this
  // fails and says why.
  const source = readFileSync(join(process.cwd(), "lib", "calculate-beacon-values.ts"), "utf8");

  it("normalizes the K and DEF pools with normalizeSlice", () => {
    const start = source.indexOf('for (const pos of ["K", "DEF"] as const)');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("perFormat.push", start));
    expect(block).toContain("normalizeSlice({");
    expect(block).not.toContain("calibrateSlice");
  });

  it("only reaches calibrateSlice for the skill pool", () => {
    expect(source.match(/calibrateSlice\(/g) ?? []).toHaveLength(1);
  });
});
