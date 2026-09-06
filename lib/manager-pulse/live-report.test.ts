import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

vi.mock("./load", () => ({ loadManagerPulseInput: vi.fn() }));
vi.mock("./engine", () => ({ computeFootprint: vi.fn() }));

import { loadManagerPulseInput } from "./load";
import { computeFootprint } from "./engine";
import { shouldComputeLiveReport, computeLiveReport } from "./live-report";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import type { ManagerPulseInput } from "./input-types";
import type { ManagerReport } from "./types";

const mockLoad = vi.mocked(loadManagerPulseInput);
const mockCompute = vi.mocked(computeFootprint);

const SYNC = DEFAULT_MANAGER_PULSE_SETTINGS.sync;

/* -------------------------------------------------------------------------- */
/* shouldComputeLiveReport: pure. The checkpoint table from the spec:         */
/* first at 3; then 8 only after 20s; 13 immediately once 20s has passed.     */
/* -------------------------------------------------------------------------- */

describe("shouldComputeLiveReport", () => {
  const NOW = Date.parse("2026-09-05T12:00:00.000Z");

  it("says no before the first checkpoint threshold", () => {
    expect(
      shouldComputeLiveReport({
        leaguesDone: 2,
        lastCheckpointDone: 0,
        lastCheckpointAt: null,
        nowMs: NOW,
        sync: SYNC,
      }),
    ).toBe(false);
  });

  it("fires the first checkpoint the moment liveReportFirstAfter is reached", () => {
    expect(
      shouldComputeLiveReport({
        leaguesDone: 3,
        lastCheckpointDone: 0,
        lastCheckpointAt: null,
        nowMs: NOW,
        sync: SYNC,
      }),
    ).toBe(true);
  });

  it("withholds the next checkpoint until liveReportEveryLeagues more are done, regardless of time", () => {
    expect(
      shouldComputeLiveReport({
        leaguesDone: 7,
        lastCheckpointDone: 3,
        lastCheckpointAt: new Date(NOW - 60_000).toISOString(),
        nowMs: NOW,
        sync: SYNC,
      }),
    ).toBe(false);
  });

  it("withholds the 8th-league checkpoint until liveReportMinIntervalMs has passed", () => {
    const tenSecondsAgo = new Date(NOW - 10_000).toISOString();
    expect(
      shouldComputeLiveReport({
        leaguesDone: 8,
        lastCheckpointDone: 3,
        lastCheckpointAt: tenSecondsAgo,
        nowMs: NOW,
        sync: SYNC,
      }),
    ).toBe(false);
  });

  it("fires the 8th-league checkpoint once 20s has passed", () => {
    const twentyFiveSecondsAgo = new Date(NOW - 25_000).toISOString();
    expect(
      shouldComputeLiveReport({
        leaguesDone: 8,
        lastCheckpointDone: 3,
        lastCheckpointAt: twentyFiveSecondsAgo,
        nowMs: NOW,
        sync: SYNC,
      }),
    ).toBe(true);
  });

  it("fires the 13th-league checkpoint immediately once 20s has passed", () => {
    const twentyFiveSecondsAgo = new Date(NOW - 25_000).toISOString();
    expect(
      shouldComputeLiveReport({
        leaguesDone: 13,
        lastCheckpointDone: 8,
        lastCheckpointAt: twentyFiveSecondsAgo,
        nowMs: NOW,
        sync: SYNC,
      }),
    ).toBe(true);
  });

  it("always fires the first checkpoint (lastCheckpointDone === 0) even mid-window", () => {
    expect(
      shouldComputeLiveReport({
        leaguesDone: 4,
        lastCheckpointDone: 0,
        lastCheckpointAt: null,
        nowMs: NOW,
        sync: SYNC,
      }),
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* A minimal fake PostgREST client, keyed by table and operation              */
/* -------------------------------------------------------------------------- */

type FakeResponse = { data: unknown; error: { message: string } | null };
type TableHandlers = {
  select?: () => FakeResponse;
  upsert?: (payload: unknown, opts?: unknown) => FakeResponse;
  update?: (payload: unknown) => FakeResponse;
};
type RecordedCall = { table: string; op: "select" | "upsert" | "update"; args: unknown[] };

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
      };
    },
  };

  return { admin: admin as unknown as SupabaseClient<Database>, calls };
}

const RUN_ROW = {
  sleeper_user_id: "u1",
  sleeper_handle: "someone",
  season_from: 2023,
  season_to: 2026,
  leagues_total: 10,
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

function fakeReport(): ManagerReport {
  return {
    identity: {
      sleeperUserId: "u1",
      handle: "someone",
      avatarUrl: null,
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

beforeEach(() => {
  mockLoad.mockReset();
  mockCompute.mockReset();
  mockLoad.mockResolvedValue(FAKE_INPUT);
  mockCompute.mockReturnValue(fakeReport());
});

/* -------------------------------------------------------------------------- */
/* computeLiveReport                                                          */
/* -------------------------------------------------------------------------- */

describe("computeLiveReport", () => {
  it("writes coverage, coverage_total and version+1, then updates the run's checkpoint columns", async () => {
    const { admin, calls } = makeFakeAdmin({
      manager_pulse_runs: {
        select: () => ({ data: RUN_ROW, error: null }),
        update: () => ({ data: null, error: null }),
      },
      manager_pulse_live_reports: {
        select: () => ({ data: { version: 2, report: fakeReport() }, error: null }),
        upsert: () => ({ data: null, error: null }),
      },
      manager_pulse_run_leagues: {
        select: () => runLeagueRows(["done", "fresh"]),
      },
    });

    await computeLiveReport(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS);

    const upsertCall = calls.find((c) => c.table === "manager_pulse_live_reports" && c.op === "upsert");
    expect(upsertCall).toBeDefined();
    const payload = upsertCall!.args[0] as {
      coverage: number;
      coverage_total: number;
      version: number;
    };
    expect(payload.coverage).toBe(2);
    expect(payload.coverage_total).toBe(10);
    expect(payload.version).toBe(3);

    const runUpdate = calls.find((c) => c.table === "manager_pulse_runs" && c.op === "update");
    expect(runUpdate).toBeDefined();
    const runPayload = runUpdate!.args[0] as { live_checkpoint_done: number; live_checkpoint_at: string };
    expect(runPayload.live_checkpoint_done).toBe(2);
    expect(typeof runPayload.live_checkpoint_at).toBe("string");
  });

  it("starts version at 1 when there is no existing live row", async () => {
    const { admin, calls } = makeFakeAdmin({
      manager_pulse_runs: {
        select: () => ({ data: RUN_ROW, error: null }),
        update: () => ({ data: null, error: null }),
      },
      manager_pulse_live_reports: {
        select: () => ({ data: null, error: null }),
        upsert: () => ({ data: null, error: null }),
      },
      manager_pulse_run_leagues: { select: () => runLeagueRows(["done"]) },
    });

    await computeLiveReport(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS);

    const upsertCall = calls.find((c) => c.table === "manager_pulse_live_reports" && c.op === "upsert");
    expect((upsertCall!.args[0] as { version: number }).version).toBe(1);
  });

  it("leaves the previous live report and the run's checkpoint columns untouched when the write fails", async () => {
    const { admin, calls } = makeFakeAdmin({
      manager_pulse_runs: {
        select: () => ({ data: RUN_ROW, error: null }),
        update: () => ({ data: null, error: null }),
      },
      manager_pulse_live_reports: {
        select: () => ({ data: { version: 1, report: fakeReport() }, error: null }),
        upsert: () => ({ data: null, error: { message: "write failed" } }),
      },
      manager_pulse_run_leagues: { select: () => runLeagueRows(["done"]) },
    });

    await computeLiveReport(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS);

    const runUpdate = calls.find((c) => c.table === "manager_pulse_runs" && c.op === "update");
    expect(runUpdate).toBeUndefined();
  });

  it("never throws when the run row cannot be read", async () => {
    const { admin } = makeFakeAdmin({
      manager_pulse_runs: {
        select: () => ({ data: null, error: { message: "not found" } }),
      },
    });

    await expect(
      computeLiveReport(admin, "missing-run", DEFAULT_MANAGER_PULSE_SETTINGS),
    ).resolves.toBeUndefined();
  });

  it("never throws when the compute step itself throws", async () => {
    mockLoad.mockRejectedValue(new Error("sleeper is down"));

    const { admin } = makeFakeAdmin({
      manager_pulse_runs: {
        select: () => ({ data: RUN_ROW, error: null }),
        update: () => ({ data: null, error: null }),
      },
      manager_pulse_live_reports: {
        select: () => ({ data: null, error: null }),
        upsert: () => ({ data: null, error: null }),
      },
      manager_pulse_run_leagues: { select: () => runLeagueRows(["done"]) },
    });

    await expect(computeLiveReport(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS)).resolves.toBeUndefined();
  });

  it("serializes two concurrent calls for the same subject through coalesce", async () => {
    const { admin, calls } = makeFakeAdmin({
      manager_pulse_runs: {
        select: () => ({ data: RUN_ROW, error: null }),
        update: () => ({ data: null, error: null }),
      },
      manager_pulse_live_reports: {
        select: () => ({ data: null, error: null }),
        upsert: () => ({ data: null, error: null }),
      },
      manager_pulse_run_leagues: { select: () => runLeagueRows(["done"]) },
    });

    await Promise.all([
      computeLiveReport(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS),
      computeLiveReport(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS),
    ]);

    const upsertCalls = calls.filter((c) => c.table === "manager_pulse_live_reports" && c.op === "upsert");
    expect(upsertCalls.length).toBe(1);
  });
});
