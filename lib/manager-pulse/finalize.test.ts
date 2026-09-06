import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/*
 * finalize.ts orchestrates four pure/impure collaborators: load, engine,
 * tendencies and fingerprint. Mocking them here means these tests exercise
 * ONLY the orchestration MPS-T040 describes (the fingerprint-match
 * short-circuit, the write, the close, the delete, and the never-throws
 * guarantee), not the engine's own arithmetic, which is covered elsewhere.
 */
vi.mock("./load", () => ({ loadManagerPulseInput: vi.fn() }));
vi.mock("./engine", () => ({ computeFootprint: vi.fn() }));
vi.mock("./tendencies", () => ({
  buildTendency: vi.fn(),
  tendencySamples: vi.fn(() => ({ dynasty: 0, redraft: 0 })),
}));
vi.mock("./fingerprint", () => ({ managerPulseFingerprint: vi.fn() }));

import { loadManagerPulseInput } from "./load";
import { computeFootprint } from "./engine";
import { buildTendency, tendencySamples } from "./tendencies";
import { managerPulseFingerprint } from "./fingerprint";
import { finalizeManagerPulseRun } from "./finalize";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import type { ManagerPulseInput } from "./input-types";
import type { ManagerReport, ManagerTendency } from "./types";

const mockLoad = vi.mocked(loadManagerPulseInput);
const mockCompute = vi.mocked(computeFootprint);
const mockBuildTendency = vi.mocked(buildTendency);
const mockFingerprint = vi.mocked(managerPulseFingerprint);

/* -------------------------------------------------------------------------- */
/* A minimal fake PostgREST client, keyed by table and operation              */
/* -------------------------------------------------------------------------- */

type FakeResponse = { data: unknown; error: { message: string } | null };
type TableHandlers = {
  select?: () => FakeResponse;
  upsert?: (payload: unknown, opts?: unknown) => FakeResponse;
  update?: (payload: unknown) => FakeResponse;
  delete?: () => FakeResponse;
};
type RecordedCall = { table: string; op: "select" | "upsert" | "update" | "delete"; args: unknown[] };

function makeFakeAdmin(handlers: Record<string, TableHandlers>) {
  const calls: RecordedCall[] = [];

  class Chain implements PromiseLike<FakeResponse> {
    constructor(private readonly resolve: () => FakeResponse) {}
    select() {
      return this;
    }
    eq() {
      return this;
    }
    in() {
      return this;
    }
    range() {
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    maybeSingle() {
      return Promise.resolve(this.resolve());
    }
    then<A, B>(
      onOk?: ((value: FakeResponse) => A | PromiseLike<A>) | null,
      onErr?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve(this.resolve()).then(onOk, onErr);
    }
  }

  const admin = {
    calls,
    from(table: string) {
      const h = handlers[table];
      if (!h) throw new Error(`fake admin: no handler for table ${table}`);
      return {
        select: (...args: unknown[]) => {
          calls.push({ table, op: "select", args });
          return new Chain(() => (h.select ? h.select() : { data: null, error: null }));
        },
        upsert: (payload: unknown, opts?: unknown) => {
          calls.push({ table, op: "upsert", args: [payload, opts] });
          return new Chain(() => (h.upsert ? h.upsert(payload, opts) : { data: null, error: null }));
        },
        update: (payload: unknown) => {
          calls.push({ table, op: "update", args: [payload] });
          return new Chain(() => (h.update ? h.update(payload) : { data: null, error: null }));
        },
        delete: () => {
          calls.push({ table, op: "delete", args: [] });
          return new Chain(() => (h.delete ? h.delete() : { data: null, error: null }));
        },
      };
    },
  };

  return { admin: admin as unknown as SupabaseClient<Database>, calls };
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const RUN_ROW = {
  sleeper_user_id: "u1",
  sleeper_handle: "someone",
  season_from: 2023,
  season_to: 2026,
};

function runLeagueRows(statuses: string[]) {
  return {
    data: statuses.map((status, i) => ({
      sleeper_league_id: `L${i}`,
      season: 2026,
      league_name: `League ${i}`,
      league_category: "dynasty",
      status,
    })),
    error: null,
  };
}

const FAKE_INPUT = {
  leagueSeasons: [{ sleeperLeagueId: "L0", season: 2026 }],
  moves: [],
  drafts: [],
  weeklyMoves: [],
} as unknown as ManagerPulseInput;

function fakeReport(avatarUrl: string | null = null): ManagerReport {
  return {
    identity: {
      sleeperUserId: "u1",
      handle: "someone",
      avatarUrl,
      seasonsCovered: 1,
      leagueSeasonsFound: 1,
      splits: { dynasty: 1, redraft: 0, bestBallDynasty: 0, bestBallRedraft: 0 },
      firstSeasonSeen: 2023,
    },
    counts: { leagueSeasons: 1, dynasty: 1, redraft: 0 },
    generatedAt: "2026-01-01T00:00:00.000Z",
    modelVersion: DEFAULT_MANAGER_PULSE_SETTINGS.modelVersion,
  } as unknown as ManagerReport;
}

const FAKE_TENDENCY = { sleeperUserId: "u1", seasonsCovered: 1 } as unknown as ManagerTendency;

beforeEach(() => {
  mockLoad.mockReset();
  mockCompute.mockReset();
  mockBuildTendency.mockReset();
  mockFingerprint.mockReset();
  mockLoad.mockResolvedValue(FAKE_INPUT);
  mockBuildTendency.mockReturnValue(FAKE_TENDENCY);
});

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("finalizeManagerPulseRun", () => {
  it("closes the run as complete without writing when the fingerprint matches the cache", async () => {
    mockCompute.mockReturnValue(fakeReport());
    mockFingerprint.mockReturnValue("same-fingerprint");

    const { admin, calls } = makeFakeAdmin({
      manager_pulse_runs: {
        select: () => ({ data: RUN_ROW, error: null }),
        update: () => ({ data: null, error: null }),
      },
      manager_pulse_cache: {
        select: () => ({
          data: { report: fakeReport(), fingerprint: "same-fingerprint", generated_at: "2026-01-01T00:00:00.000Z" },
          error: null,
        }),
      },
      manager_pulse_run_leagues: {
        select: () => runLeagueRows(["done"]),
      },
      manager_pulse_live_reports: {
        delete: () => ({ data: null, error: null }),
      },
    });

    await finalizeManagerPulseRun(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS);

    const cacheWrite = calls.find((c) => c.table === "manager_pulse_cache" && c.op === "upsert");
    expect(cacheWrite).toBeUndefined();
    expect(mockBuildTendency).not.toHaveBeenCalled();

    const runUpdate = calls.find((c) => c.table === "manager_pulse_runs" && c.op === "update");
    expect(runUpdate).toBeDefined();
    expect((runUpdate!.args[0] as { status: string; detail: string | null }).status).toBe("complete");
    expect((runUpdate!.args[0] as { status: string; detail: string | null }).detail).toBeNull();

    const liveDelete = calls.find((c) => c.table === "manager_pulse_live_reports" && c.op === "delete");
    expect(liveDelete).toBeDefined();
  });

  it("closes the run as error when the compute step throws, never propagating", async () => {
    mockLoad.mockRejectedValue(new Error("sleeper is down"));

    const { admin, calls } = makeFakeAdmin({
      manager_pulse_runs: {
        select: () => ({ data: RUN_ROW, error: null }),
        update: () => ({ data: null, error: null }),
      },
      manager_pulse_cache: {
        select: () => ({ data: null, error: null }),
      },
      manager_pulse_run_leagues: {
        select: () => runLeagueRows(["done"]),
      },
    });

    await expect(finalizeManagerPulseRun(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS)).resolves.toBeUndefined();

    const runUpdate = calls.find((c) => c.table === "manager_pulse_runs" && c.op === "update");
    expect(runUpdate).toBeDefined();
    const payload = runUpdate!.args[0] as { status: string; detail: string | null };
    expect(payload.status).toBe("error");
    expect(payload.detail).toBe("The report could not be built.");
  });

  it("on success, writes the cache and tendency rows and deletes the live report", async () => {
    const report = fakeReport("http://avatar.example/u1.png");
    mockCompute.mockReturnValue(report);
    mockFingerprint.mockReturnValue("new-fingerprint");

    const { admin, calls } = makeFakeAdmin({
      manager_pulse_runs: {
        select: () => ({ data: RUN_ROW, error: null }),
        update: () => ({ data: null, error: null }),
      },
      manager_pulse_cache: {
        select: () => ({ data: null, error: null }),
        upsert: () => ({ data: null, error: null }),
      },
      manager_pulse_tendencies: {
        upsert: () => ({ data: null, error: null }),
      },
      manager_pulse_run_leagues: {
        select: () => runLeagueRows(["done", "fresh"]),
      },
      manager_pulse_live_reports: {
        delete: () => ({ data: null, error: null }),
      },
    });

    await finalizeManagerPulseRun(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS);

    const cacheWrite = calls.find((c) => c.table === "manager_pulse_cache" && c.op === "upsert");
    expect(cacheWrite).toBeDefined();
    expect((cacheWrite!.args[0] as { sleeper_user_id: string }).sleeper_user_id).toBe("u1");

    const tendencyWrite = calls.find((c) => c.table === "manager_pulse_tendencies" && c.op === "upsert");
    expect(tendencyWrite).toBeDefined();

    const runUpdate = calls.find((c) => c.table === "manager_pulse_runs" && c.op === "update");
    expect((runUpdate!.args[0] as { status: string }).status).toBe("complete");

    const liveDelete = calls.find((c) => c.table === "manager_pulse_live_reports" && c.op === "delete");
    expect(liveDelete).toBeDefined();

    // avatarUrl came from null (no prior cache), never a re-resolved handle.
    expect(mockLoad).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ avatarUrl: null, sleeperUserId: "u1", handle: "someone" }),
    );
  });

  it("resolves avatarUrl from the newest cached report's identity rather than re-resolving the handle", async () => {
    mockCompute.mockReturnValue(fakeReport("http://avatar.example/cached.png"));
    mockFingerprint.mockReturnValue("new-fingerprint");

    const { admin } = makeFakeAdmin({
      manager_pulse_runs: {
        select: () => ({ data: RUN_ROW, error: null }),
        update: () => ({ data: null, error: null }),
      },
      manager_pulse_cache: {
        select: () => ({
          data: {
            report: fakeReport("http://avatar.example/cached.png"),
            fingerprint: "old-fingerprint",
            generated_at: "2026-01-01T00:00:00.000Z",
          },
          error: null,
        }),
        upsert: () => ({ data: null, error: null }),
      },
      manager_pulse_tendencies: { upsert: () => ({ data: null, error: null }) },
      manager_pulse_run_leagues: { select: () => runLeagueRows(["done"]) },
      manager_pulse_live_reports: { delete: () => ({ data: null, error: null }) },
    });

    await finalizeManagerPulseRun(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS);

    expect(mockLoad).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ avatarUrl: "http://avatar.example/cached.png" }),
    );
  });

  it("closes the run as complete, with the empty-window detail, when the run has no league-seasons", async () => {
    const { admin, calls } = makeFakeAdmin({
      manager_pulse_runs: {
        select: () => ({ data: RUN_ROW, error: null }),
        update: () => ({ data: null, error: null }),
      },
      manager_pulse_cache: { select: () => ({ data: null, error: null }) },
      manager_pulse_run_leagues: { select: () => ({ data: [], error: null }) },
      manager_pulse_live_reports: { delete: () => ({ data: null, error: null }) },
    });

    await finalizeManagerPulseRun(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS);

    expect(mockLoad).not.toHaveBeenCalled();
    const runUpdate = calls.find((c) => c.table === "manager_pulse_runs" && c.op === "update");
    expect((runUpdate!.args[0] as { detail: string }).detail).toBe("No league-seasons in the window.");
  });

  it("closes the run as error, never throwing, when the run row cannot be read", async () => {
    const { admin, calls } = makeFakeAdmin({
      manager_pulse_runs: {
        select: () => ({ data: null, error: { message: "not found" } }),
        update: () => ({ data: null, error: null }),
      },
    });

    await expect(finalizeManagerPulseRun(admin, "missing-run", DEFAULT_MANAGER_PULSE_SETTINGS)).resolves.toBeUndefined();

    const runUpdate = calls.find((c) => c.table === "manager_pulse_runs" && c.op === "update");
    expect((runUpdate!.args[0] as { status: string }).status).toBe("error");
  });
});
