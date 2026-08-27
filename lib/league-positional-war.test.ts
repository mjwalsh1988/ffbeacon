/**
 * Coverage for lib/league-positional-war.ts: the return-shape classifier, the
 * window/team-count/projection skip branches, the backoff and its bypasses,
 * and the write ordering. Mirrors the pattern in lib/league-power-pulse.test.ts.
 *
 * lib/positional-war/share.ts (resolveSharedCurves) is tested on its own in
 * lib/positional-war/share.test.ts, so it is mocked here: the default
 * implementation just runs the supplied `compute()` callback and reports
 * success, which is enough to exercise the orchestrator's own branches
 * (skip reasons, backoff, write ordering) without re-testing the hit/miss/
 * collision logic a second time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sleeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sleeper")>();
  return { ...actual, getNflState: vi.fn() };
});

vi.mock("@/lib/power-pulse/load", () => ({
  loadLeague: vi.fn(),
}));

vi.mock("@/lib/power-pulse/settings", () => ({
  loadPowerPulseSettings: vi.fn(),
}));

vi.mock("@/lib/positional-war/load", () => ({
  loadWarUniverse: vi.fn(),
  loadProjectionsSnapshot: vi.fn(),
  buildWarPlayers: vi.fn(),
}));

vi.mock("@/lib/positional-war/engine", () => ({
  computeCurves: vi.fn(),
}));

vi.mock("@/lib/positional-war/share", () => ({
  resolveSharedCurves: vi.fn(),
}));

// warFingerprint/warInputsDigest are real sha256 hashes in production
// (lib/positional-war/fingerprint.ts is tested on its own in
// fingerprint.test.ts). Swapped here for a small deterministic stand-in so a
// test can hardcode the exact "stored fingerprint" that represents "nothing
// changed" without duplicating the hashing logic. digestsMatch is untouched
// since only lib/positional-war/share.ts (tested separately) reads it.
vi.mock("@/lib/positional-war/fingerprint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/positional-war/fingerprint")>();
  return {
    ...actual,
    warFingerprint: (input: { season: number; fromWeek: number; toWeek: number; teamCount: number; scoringSettings: unknown }) =>
      `fp:${input.season}:${input.fromWeek}:${input.toWeek}:${input.teamCount}:${JSON.stringify(input.scoringSettings)}`,
    warInputsDigest: (input: { season: number; fromWeek: number; toWeek: number; teamCount: number; modelVersion: string }) => ({
      season: input.season,
      fromWeek: input.fromWeek,
      toWeek: input.toWeek,
      teamCount: input.teamCount,
      slots: [],
      scoringBase: "pts_ppr",
      scoringUsable: true,
      scoringKeyCount: 0,
      modelVersion: input.modelVersion,
    }),
  };
});

/** The fingerprint the mock above produces for fakeLeague()'s defaults, fromWeek 9 (NFL week 9), toWeek 14 (playoffWeekStart 15), teamCount 12. */
const UNCHANGED_FINGERPRINT = 'fp:2026:9:14:12:{"rec":1}';

import {
  classifyPositionalWarResult,
  positionalWarIsStale,
  refreshPositionalWar,
  calculateLeaguePositionalWar,
  POSITIONAL_WAR_RETRY_MS,
  POSITIONAL_WAR_TTL_MS,
  type PositionalWarResult,
} from "./league-positional-war";
import { getNflState } from "@/lib/sleeper";
import { loadLeague } from "@/lib/power-pulse/load";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { loadWarUniverse, loadProjectionsSnapshot, buildWarPlayers } from "@/lib/positional-war/load";
import { computeCurves } from "@/lib/positional-war/engine";
import { resolveSharedCurves } from "@/lib/positional-war/share";

/* ---------------------------------------------------------------------- */
/* Fixtures                                                                */
/* ---------------------------------------------------------------------- */

const LEAGUE_ROW_ID = "league-row-1";

function fakeLeague(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: LEAGUE_ROW_ID,
    sleeperLeagueId: "sleeper-1",
    name: "Test League",
    season: 2026,
    status: "in_season",
    rosterPositions: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"],
    scoringSettings: { rec: 1 },
    playoffTeams: 6,
    playoffWeekStart: 15,
    ...overrides,
  };
}

function fakePowerPulseSettings(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    modelVersion: "pp-1",
    reliability: { blend: 0.5 },
    availability: { discount: 0.2 },
    injury: { out: 0 },
    opponent: { weight: 1 },
    variance: { floor: 0.1 },
    recency: { current: 1, prior: 0.5 },
    war: {
      modelVersion: "war-1",
      displayDepthMultiple: 2.5,
      minDisplayDepth: 24,
      cliffThreshold: 0.5,
      clampBelowReplacement: true,
    },
    ...overrides,
  } as never;
}

function fakeCurve(position: string) {
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
  } as never;
}

/* ---------------------------------------------------------------------- */
/* Fake Supabase client                                                   */
/* ---------------------------------------------------------------------- */

type LeaguesRow = {
  season?: number;
  last_pulsed_at?: string | null;
  positional_war_status?: string | null;
  positional_war_detail?: string | null;
  positional_war_attempted_at?: string | null;
  total_rosters?: number | null;
};

/**
 * Minimal stand-in for the tables lib/league-positional-war.ts touches
 * directly: leagues, rosters (count only), and league_positional_war_cache.
 * Records every operation, in order, in `calls`, so write-ordering
 * assertions do not depend on inspecting timestamps.
 */
function makeFakeClient(
  opts: {
    leaguesRow?: LeaguesRow | null;
    rosterCount?: number | null;
    cacheRow?: Record<string, unknown> | null;
  } = {},
) {
  const calls: string[] = [];
  const leagueUpdates: Array<Record<string, unknown>> = [];
  let cacheDeleted = false;

  const leaguesBuilder = () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => Promise.resolve({ data: opts.leaguesRow ?? null, error: null }),
      update: (payload: Record<string, unknown>) => {
        calls.push(`leagues.update:${Object.keys(payload).sort().join(",")}`);
        leagueUpdates.push(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    };
    return builder;
  };

  const rostersBuilder = () => {
    const builder = {
      select: () => builder,
      eq: () => {
        calls.push("rosters.count");
        return Promise.resolve({ count: opts.rosterCount ?? null, error: null });
      },
    };
    return builder;
  };

  const cacheBuilder = () => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => {
        calls.push("cache.select");
        return Promise.resolve({ data: cacheDeleted ? null : (opts.cacheRow ?? null), error: null });
      },
      delete: () => ({
        eq: () => ({
          eq: () => {
            calls.push("cache.delete");
            cacheDeleted = true;
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
    return builder;
  };

  const client = {
    from: (table: string) => {
      if (table === "leagues") return leaguesBuilder();
      if (table === "rosters") return rostersBuilder();
      if (table === "league_positional_war_cache") return cacheBuilder();
      throw new Error(`unexpected table in test stub: ${table}`);
    },
  };

  return { client: client as never, calls, leagueUpdates };
}

/** Configure the mocked pipeline to reach a clean 'ok' result. */
function wireOkPipeline() {
  vi.mocked(loadLeague).mockResolvedValue(fakeLeague() as never);
  vi.mocked(getNflState).mockResolvedValue({
    week: 9,
    season_type: "regular",
    season: "2026",
  } as never);
  vi.mocked(loadPowerPulseSettings).mockResolvedValue(fakePowerPulseSettings());
  vi.mocked(loadProjectionsSnapshot).mockResolvedValue("2026-10-01T12:00:00.000Z");
  vi.mocked(loadWarUniverse).mockResolvedValue({
    players: new Map(),
    projections: [],
    accuracy: new Map(),
    defense: new Map(),
    defenseSeasons: [2025, 2024],
  } as never);
  vi.mocked(buildWarPlayers).mockReturnValue([{ playerId: "p1" } as never]);
  vi.mocked(computeCurves).mockReturnValue({ curves: [fakeCurve("QB"), fakeCurve("RB")], excludedSlots: [] });
  vi.mocked(resolveSharedCurves).mockImplementation(async (_supabase, params) => {
    const curves = await params.compute();
    return { ok: true, curves, shared: false, collision: false };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------------- */
/* classifyPositionalWarResult                                            */
/* ---------------------------------------------------------------------- */

describe("classifyPositionalWarResult", () => {
  const cases: Array<[string, PositionalWarResult, "ok" | "skipped" | "settled" | "error"]> = [
    [
      "ok, no skipped reason",
      { ok: true, positions: 6, season: 2026, fromWeek: 9, toWeek: 14, shared: false },
      "ok",
    ],
    [
      "unknown team count",
      { ok: true, positions: 0, season: 2026, fromWeek: 9, toWeek: 14, shared: false, skipped: "unknown team count" },
      "skipped",
    ],
    [
      "no weekly projections stored",
      {
        ok: true,
        positions: 0,
        season: 2026,
        fromWeek: 9,
        toWeek: 14,
        shared: false,
        skipped: "no weekly projections stored for 2026 from week 9",
      },
      "skipped",
    ],
    [
      "no regular season weeks remaining",
      {
        ok: true,
        positions: 0,
        season: 2026,
        fromWeek: 16,
        toWeek: 14,
        shared: false,
        skipped: "no regular season weeks remaining from week 16",
      },
      "settled",
    ],
    ["ok: false", { ok: false, error: "positional war curves upsert failed: boom" }, "error"],
  ];

  for (const [label, result, expected] of cases) {
    it(`maps "${label}" to '${expected}'`, () => {
      expect(classifyPositionalWarResult(result).status).toBe(expected);
    });
  }

  it("degrades an unrecognised skipped reason to 'skipped' rather than 'settled'", () => {
    const result: PositionalWarResult = {
      ok: true,
      positions: 0,
      season: 2026,
      fromWeek: 9,
      toWeek: 14,
      shared: false,
      skipped: "some brand new reason nobody classified yet",
    };
    expect(classifyPositionalWarResult(result).status).toBe("skipped");
  });

  it("uses the collision detail text for a successful collision recompute", () => {
    const result: PositionalWarResult = {
      ok: true,
      positions: 6,
      season: 2026,
      fromWeek: 9,
      toWeek: 14,
      shared: false,
      collision: true,
    };
    expect(classifyPositionalWarResult(result)).toEqual({
      status: "ok",
      detail: "fingerprint collision, recomputed",
    });
  });

  it("marks a shared hit in the detail text", () => {
    const result: PositionalWarResult = {
      ok: true,
      positions: 6,
      season: 2026,
      fromWeek: 9,
      toWeek: 14,
      shared: true,
    };
    expect(classifyPositionalWarResult(result).detail).toBe("6 positions, shared");
  });
});

/* ---------------------------------------------------------------------- */
/* Empty week window: settled, and clears existing rows                   */
/* ---------------------------------------------------------------------- */

describe("calculateLeaguePositionalWar: empty week window", () => {
  it("sets 'settled' and deletes existing cache rows, without touching the universe", async () => {
    wireOkPipeline();
    vi.mocked(loadLeague).mockResolvedValue(fakeLeague({ playoffWeekStart: 9 }) as never); // toWeek=8 < fromWeek=9
    const { client, calls } = makeFakeClient({ cacheRow: { fingerprint: "old" } });

    const result = await calculateLeaguePositionalWar(client, LEAGUE_ROW_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toMatch(/^no regular season weeks remaining from week/);
    expect(classifyPositionalWarResult(result).status).toBe("settled");
    expect(calls).toContain("cache.delete");
    expect(loadWarUniverse).not.toHaveBeenCalled();
    expect(resolveSharedCurves).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------- */
/* Transient skips: do NOT clear existing rows                            */
/* ---------------------------------------------------------------------- */

describe("calculateLeaguePositionalWar: transient skips", () => {
  it("'unknown team count' when total_rosters is null and no rosters are stored, never defaults to 12", async () => {
    wireOkPipeline();
    const { client, calls } = makeFakeClient({ rosterCount: 0, cacheRow: { fingerprint: "old" } });

    const result = await calculateLeaguePositionalWar(client, LEAGUE_ROW_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toBe("unknown team count");
    expect(classifyPositionalWarResult(result).status).toBe("skipped");
    expect(calls).not.toContain("cache.delete");
    expect(computeCurves).not.toHaveBeenCalled();
  });

  it("falls back to the stored roster count when total_rosters is null", async () => {
    wireOkPipeline();
    const { client } = makeFakeClient({ rosterCount: 10 });

    const result = await calculateLeaguePositionalWar(client, LEAGUE_ROW_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toBeUndefined();
    // teamCount flowed from the roster count into the model.
    expect(computeCurves).toHaveBeenCalledWith(
      expect.objectContaining({ league: expect.objectContaining({ teamCount: 10 }) }),
    );
  });

  it("uses total_rosters over a disagreeing stored roster count, and logs the discrepancy", async () => {
    wireOkPipeline();
    vi.mocked(loadLeague).mockResolvedValue(fakeLeague() as never);
    const { client } = makeFakeClient({ rosterCount: 10, leaguesRow: { total_rosters: 12 } });

    const result = await calculateLeaguePositionalWar(client, LEAGUE_ROW_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(computeCurves).toHaveBeenCalledWith(
      expect.objectContaining({ league: expect.objectContaining({ teamCount: 12 }) }),
    );
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("disagrees"));
  });

  it("'no weekly projections stored' when no projections snapshot exists", async () => {
    wireOkPipeline();
    vi.mocked(loadProjectionsSnapshot).mockResolvedValue(null);
    const { client, calls } = makeFakeClient({ rosterCount: 12, cacheRow: { fingerprint: "old" } });

    const result = await calculateLeaguePositionalWar(client, LEAGUE_ROW_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toMatch(/^no weekly projections stored for 2026 from week/);
    expect(classifyPositionalWarResult(result).status).toBe("skipped");
    expect(calls).not.toContain("cache.delete");
  });
});

/* ---------------------------------------------------------------------- */
/* No draft-pending guard: a pre-draft league still produces a full curve */
/* ---------------------------------------------------------------------- */

describe("calculateLeaguePositionalWar: pre-draft leagues", () => {
  it("a league with zero rostered players (but roster rows present) still produces a full curve", async () => {
    wireOkPipeline();
    // rosterCount > 0 (the roster SLOTS exist at league creation) but nothing
    // about player_ids is ever read by this code path: resolveTeamCount only
    // counts rows, and the universe (mocked) comes from projections, not
    // from any roster.
    const { client } = makeFakeClient({ rosterCount: 12 });

    const result = await calculateLeaguePositionalWar(client, LEAGUE_ROW_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toBeUndefined();
    expect(result.positions).toBe(2); // fakeCurve("QB"), fakeCurve("RB") from wireOkPipeline
  });
});

/* ---------------------------------------------------------------------- */
/* Determinism: no source parameter exists to flip                        */
/* ---------------------------------------------------------------------- */

describe("calculateLeaguePositionalWar: source independence", () => {
  it("produces the same fingerprint on repeated calls with unchanged league inputs", async () => {
    wireOkPipeline();
    const { client: client1 } = makeFakeClient({ rosterCount: 12 });
    const { client: client2 } = makeFakeClient({ rosterCount: 12 });

    const first = await calculateLeaguePositionalWar(client1, LEAGUE_ROW_ID);
    const second = await calculateLeaguePositionalWar(client2, LEAGUE_ROW_ID);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // calculateLeaguePositionalWar takes no source/format argument at all, so
    // there is nothing a caller could flip between these two calls; the
    // fingerprint (which also carries no source field, see
    // lib/positional-war/fingerprint.test.ts) is identical.
    expect(first.fingerprint).toBe(second.fingerprint);
  });
});

/* ---------------------------------------------------------------------- */
/* A throw inside the engine: 'error', message written, rows untouched    */
/* ---------------------------------------------------------------------- */

describe("refreshPositionalWar: a throw inside the engine", () => {
  it("sets status 'error', writes the message, stamps attempted_at, leaves existing rows alone, and does not throw", async () => {
    wireOkPipeline();
    vi.mocked(resolveSharedCurves).mockImplementation(async (_supabase, params) => {
      await params.compute(); // propagate whatever compute() throws
      throw new Error("unreachable");
    });
    vi.mocked(computeCurves).mockImplementation(() => {
      throw new Error("engine exploded");
    });

    const { client, calls, leagueUpdates } = makeFakeClient({
      leaguesRow: { season: 2026, positional_war_status: null, positional_war_attempted_at: null },
      rosterCount: 12,
      cacheRow: { fingerprint: "old" },
    });

    await expect(refreshPositionalWar(client, LEAGUE_ROW_ID, { force: true })).resolves.toBeUndefined();

    const verdictUpdate = leagueUpdates.find((u) => u.positional_war_status === "error");
    expect(verdictUpdate?.positional_war_detail).toBe("engine exploded");
    expect(verdictUpdate?.positional_war_succeeded_at).toBeUndefined();
    expect(calls).not.toContain("cache.delete");
  });
});

/* ---------------------------------------------------------------------- */
/* Backoff: no loads on a second call inside the retry window             */
/* ---------------------------------------------------------------------- */

describe("refreshPositionalWar backoff", () => {
  it("performs no universe load or share resolution for a backed-off 'skipped' league", async () => {
    wireOkPipeline();
    const { client } = makeFakeClient({
      leaguesRow: {
        season: 2026,
        last_pulsed_at: null,
        positional_war_status: "skipped",
        positional_war_detail: "unknown team count",
        positional_war_attempted_at: new Date().toISOString(),
      },
      rosterCount: 12,
      cacheRow: { fingerprint: UNCHANGED_FINGERPRINT },
    });
    // The stale check will compute the current fingerprint (cheap) and
    // compare it to the stored one; keep them equal by leaving every input
    // the same across the "last attempt" and "now".
    vi.mocked(loadLeague).mockResolvedValue(fakeLeague() as never);

    await refreshPositionalWar(client, LEAGUE_ROW_ID);

    expect(loadWarUniverse).not.toHaveBeenCalled();
    expect(resolveSharedCurves).not.toHaveBeenCalled();
  });

  it("performs no universe load or share resolution for a backed-off 'error' league", async () => {
    wireOkPipeline();
    const { client } = makeFakeClient({
      leaguesRow: {
        season: 2026,
        last_pulsed_at: null,
        positional_war_status: "error",
        positional_war_detail: "boom",
        positional_war_attempted_at: new Date().toISOString(),
      },
      rosterCount: 12,
      cacheRow: { fingerprint: UNCHANGED_FINGERPRINT },
    });

    await refreshPositionalWar(client, LEAGUE_ROW_ID);

    expect(loadWarUniverse).not.toHaveBeenCalled();
    expect(resolveSharedCurves).not.toHaveBeenCalled();
  });

  it("performs no universe load for a backed-off 'settled' league whose (season, fromWeek, toWeek) triple is unchanged", async () => {
    wireOkPipeline();
    const { client } = makeFakeClient({
      leaguesRow: {
        season: 2026,
        last_pulsed_at: null,
        positional_war_status: "settled",
        positional_war_detail:
          "no regular season weeks remaining from week 9 [settled season=2026 fromWeek=9 toWeek=8]",
        positional_war_attempted_at: new Date().toISOString(),
      },
      rosterCount: 12,
    });
    vi.mocked(loadLeague).mockResolvedValue(fakeLeague({ playoffWeekStart: 9 }) as never);

    await refreshPositionalWar(client, LEAGUE_ROW_ID);

    expect(loadWarUniverse).not.toHaveBeenCalled();
    expect(resolveSharedCurves).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------- */
/* Backoff bypasses                                                        */
/* ---------------------------------------------------------------------- */

describe("refreshPositionalWar backoff bypasses", () => {
  it("force:true recomputes a backed-off 'skipped' league", async () => {
    wireOkPipeline();
    const { client } = makeFakeClient({
      leaguesRow: {
        season: 2026,
        positional_war_status: "skipped",
        positional_war_detail: "unknown team count",
        positional_war_attempted_at: new Date().toISOString(),
      },
      rosterCount: 12,
    });

    await refreshPositionalWar(client, LEAGUE_ROW_ID, { force: true });

    expect(resolveSharedCurves).toHaveBeenCalledTimes(1);
  });

  it("bypasses the backoff for 'skipped' when last_pulsed_at advanced since the attempt", async () => {
    wireOkPipeline();
    const attemptedAt = new Date(Date.now() - 60_000).toISOString();
    const lastPulsedAt = new Date().toISOString();
    const { client } = makeFakeClient({
      leaguesRow: {
        season: 2026,
        last_pulsed_at: lastPulsedAt,
        positional_war_status: "skipped",
        positional_war_detail: "unknown team count",
        positional_war_attempted_at: attemptedAt,
      },
      rosterCount: 12,
    });

    await refreshPositionalWar(client, LEAGUE_ROW_ID);

    expect(resolveSharedCurves).toHaveBeenCalledTimes(1);
  });

  it("bypasses the backoff for 'error' or 'skipped' when the fingerprint changed", async () => {
    wireOkPipeline();
    // Different scoring settings than whatever produced the stored
    // fingerprint below: the cheap fingerprint recompute will differ from
    // "some-other-fingerprint", triggering the bypass.
    vi.mocked(loadLeague).mockResolvedValue(fakeLeague({ scoringSettings: { rec: 1, pass_td: 6 } }) as never);
    const { client } = makeFakeClient({
      leaguesRow: {
        season: 2026,
        last_pulsed_at: null,
        positional_war_status: "skipped",
        positional_war_detail: "unknown team count",
        positional_war_attempted_at: new Date().toISOString(),
      },
      rosterCount: 12,
      cacheRow: { fingerprint: "some-other-fingerprint" },
    });

    await refreshPositionalWar(client, LEAGUE_ROW_ID);

    expect(resolveSharedCurves).toHaveBeenCalledTimes(1);
  });

  it("recomputes a 'settled' league once the (season, fromWeek, toWeek) triple changes", async () => {
    wireOkPipeline();
    // Stored triple says fromWeek=9 (toWeek=8, empty window); live NFL state
    // has moved to week 10, so the window is no longer empty and the triple
    // no longer matches.
    vi.mocked(getNflState).mockResolvedValue({ week: 10, season_type: "regular", season: "2026" } as never);
    vi.mocked(loadLeague).mockResolvedValue(fakeLeague({ playoffWeekStart: 12 }) as never);
    const { client } = makeFakeClient({
      leaguesRow: {
        season: 2026,
        last_pulsed_at: null,
        positional_war_status: "settled",
        positional_war_detail:
          "no regular season weeks remaining from week 9 [settled season=2026 fromWeek=9 toWeek=8]",
        positional_war_attempted_at: new Date(Date.now() - 60_000).toISOString(),
      },
      rosterCount: 12,
    });

    await refreshPositionalWar(client, LEAGUE_ROW_ID);

    expect(resolveSharedCurves).toHaveBeenCalledTimes(1);
  });
});

/* ---------------------------------------------------------------------- */
/* Write ordering: attempted_at before the loads, succeeded_at after       */
/* ---------------------------------------------------------------------- */

describe("refreshPositionalWar write ordering", () => {
  it("stamps attempted_at, then resolves the shared curves, then stamps the verdict with succeeded_at", async () => {
    wireOkPipeline();
    const { client, calls, leagueUpdates } = makeFakeClient({
      leaguesRow: { season: 2026, positional_war_status: null, positional_war_attempted_at: null },
      rosterCount: 12,
    });

    await refreshPositionalWar(client, LEAGUE_ROW_ID, { force: true });

    const attemptedIdx = calls.indexOf("leagues.update:positional_war_attempted_at");
    const verdictIdx = calls.findIndex(
      (c) => c.startsWith("leagues.update:") && c.includes("positional_war_succeeded_at"),
    );

    expect(attemptedIdx).toBeGreaterThanOrEqual(0);
    expect(verdictIdx).toBeGreaterThan(attemptedIdx);
    expect(resolveSharedCurves).toHaveBeenCalledTimes(1);

    const verdictUpdate = leagueUpdates.find((u) => "positional_war_succeeded_at" in u);
    expect(verdictUpdate?.positional_war_status).toBe("ok");
  });

  it("does not stamp succeeded_at when the run ends in 'error'", async () => {
    wireOkPipeline();
    vi.mocked(resolveSharedCurves).mockRejectedValue(new Error("db unreachable"));

    const { client, leagueUpdates } = makeFakeClient({
      leaguesRow: { season: 2026, positional_war_status: null, positional_war_attempted_at: null },
      rosterCount: 12,
    });

    await refreshPositionalWar(client, LEAGUE_ROW_ID, { force: true });

    const verdictUpdate = leagueUpdates.find((u) => "positional_war_status" in u);
    expect(verdictUpdate?.positional_war_status).toBe("error");
    expect(verdictUpdate?.positional_war_succeeded_at).toBeUndefined();
  });
});

/* ---------------------------------------------------------------------- */
/* Settled detail encoding                                                 */
/* ---------------------------------------------------------------------- */

describe("settled verdict detail encoding", () => {
  it("encodes (season, fromWeek, toWeek) into positional_war_detail", async () => {
    wireOkPipeline();
    vi.mocked(loadLeague).mockResolvedValue(fakeLeague({ playoffWeekStart: 9 }) as never); // toWeek=8 < fromWeek=9

    const { client, leagueUpdates } = makeFakeClient({
      leaguesRow: { season: 2026, positional_war_status: null, positional_war_attempted_at: null },
      rosterCount: 12,
    });

    await refreshPositionalWar(client, LEAGUE_ROW_ID, { force: true });

    const verdictUpdate = leagueUpdates.find((u) => u.positional_war_status === "settled");
    expect(verdictUpdate?.positional_war_detail).toBe(
      "no regular season weeks remaining from week 9 [settled season=2026 fromWeek=9 toWeek=8]",
    );
  });
});

/* ---------------------------------------------------------------------- */
/* Constant sanity                                                         */
/* ---------------------------------------------------------------------- */

describe("POSITIONAL_WAR_RETRY_MS / POSITIONAL_WAR_TTL_MS", () => {
  it("matches Power Pulse's constants", () => {
    expect(POSITIONAL_WAR_RETRY_MS).toBe(15 * 60 * 1000);
    expect(POSITIONAL_WAR_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });
});

/* ---------------------------------------------------------------------- */
/* positionalWarIsStale: direct coverage of the memoised-context contract  */
/* ---------------------------------------------------------------------- */

describe("positionalWarIsStale", () => {
  it("returns true (not backed off) for a null status: a normal first attempt", async () => {
    wireOkPipeline();
    const { client } = makeFakeClient({
      leaguesRow: {
        season: 2026,
        last_pulsed_at: null,
        positional_war_status: null,
        positional_war_attempted_at: null,
      },
      rosterCount: 12,
    });

    const stale = await positionalWarIsStale(client, LEAGUE_ROW_ID, 2026, () => Promise.resolve(null));
    expect(stale).toBe(true);
  });
});
