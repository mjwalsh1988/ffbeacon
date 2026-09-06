import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

vi.mock("@/lib/sleeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sleeper")>();
  return {
    ...actual,
    currentNflSeason: vi.fn(() => "2026"),
  };
});

vi.mock("@/lib/league-pulse", () => ({
  pulseLeagueCore: vi.fn(),
  pulseLeagueDerived: vi.fn(),
  pulseLeagueFootprint: vi.fn(),
}));

vi.mock("@/lib/manager-pulse/settings", () => ({
  loadManagerPulseSettings: vi.fn(),
}));

vi.mock("@/lib/manager-pulse/freshness", () => ({
  managerPulseNeedsCapture: vi.fn(() => true),
}));

vi.mock("@/lib/manager-pulse/finalize", () => ({
  finalizeManagerPulseRun: vi.fn(),
}));

vi.mock("@/lib/manager-pulse/live-report", () => ({
  shouldComputeLiveReport: vi.fn(() => false),
  computeLiveReport: vi.fn(),
}));

vi.mock("@/lib/request-coalesce", () => ({
  coalesce: vi.fn((_key: string, run: () => Promise<unknown>) => run()),
}));

import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { loadManagerPulseSettings } from "@/lib/manager-pulse/settings";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "@/lib/manager-pulse/default-settings";
import type { ManagerPulseSyncSettings } from "@/lib/manager-pulse/default-settings";
import type { ManagerPulseSettings } from "@/lib/manager-pulse/types";
import { acquireSleeperToken, _resetSleeperBudgetForTests } from "@/lib/sleeper-budget";
import { shouldComputeLiveReport, computeLiveReport } from "@/lib/manager-pulse/live-report";
import { runLeagueSyncWorker, type LeagueSyncJob } from "@/lib/league-bulk-sync";

const mockPulseLeagueCore = vi.mocked(pulseLeagueCore);
const mockPulseLeagueDerived = vi.mocked(pulseLeagueDerived);
const mockLoadSettings = vi.mocked(loadManagerPulseSettings);
const mockShouldComputeLiveReport = vi.mocked(shouldComputeLiveReport);
const mockComputeLiveReport = vi.mocked(computeLiveReport);

/* -------------------------------------------------------------------------- */
/* A minimal fake PostgREST + RPC client (the fake-admin style of             */
/* lib/manager-pulse/capture.test.ts, extended with update() support)         */
/* -------------------------------------------------------------------------- */

type FakeResponse = { data: unknown; error: unknown; count?: number };
type RpcCall = { name: string; args: unknown };
type UpdateCall = { table: string; payload: Record<string, unknown> };

type TableHandler = (op: "select" | "update", payload?: Record<string, unknown>) => FakeResponse;

function makeChain(resolve: () => FakeResponse) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    lt: () => chain,
    lte: () => chain,
    gte: () => chain,
    is: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(resolve()),
    then: (onOk: (v: FakeResponse) => unknown, onErr: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onOk, onErr),
  };
  return chain;
}

function makeFakeAdmin(opts: {
  tableHandlers: Record<string, TableHandler>;
  rpcHandler: (name: string, args: unknown) => FakeResponse;
}) {
  const rpcCalls: RpcCall[] = [];
  const updateCalls: UpdateCall[] = [];

  const admin = {
    from(table: string) {
      const handler = opts.tableHandlers[table];
      if (!handler) throw new Error(`fake admin: no handler for table ${table}`);
      return {
        select: () => makeChain(() => handler("select")),
        update: (payload: Record<string, unknown>) => {
          updateCalls.push({ table, payload });
          return makeChain(() => handler("update", payload));
        },
      };
    },
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      return Promise.resolve(opts.rpcHandler(name, args));
    },
  };

  return {
    admin: admin as unknown as SupabaseClient<Database>,
    rpcCalls,
    updateCalls,
  };
}

/** No stale jobs to reap, nothing waiting to be finalized. */
function baseTableHandlers(): Record<string, TableHandler> {
  return {
    league_sync_jobs: (op) => (op === "select" ? { data: [], error: null } : { data: [{ id: "won" }], error: null }),
    manager_pulse_runs: () => ({ data: [], error: null }),
  };
}

/** try_acquire_league_sync_lease always succeeds; claim_league_sync_jobs hands out `jobs` once, then nothing. */
function makeRpcHandler(opts: { leaseOk: boolean; jobs: LeagueSyncJob[] }) {
  let claimCalls = 0;
  return (name: string): FakeResponse => {
    if (name === "try_acquire_league_sync_lease") return { data: opts.leaseOk, error: null };
    if (name === "claim_league_sync_jobs") {
      claimCalls += 1;
      return claimCalls === 1 ? { data: opts.jobs, error: null } : { data: [], error: null };
    }
    return { data: null, error: null };
  };
}

function buildSettings(sync: Partial<ManagerPulseSyncSettings> = {}): ManagerPulseSettings {
  return {
    ...DEFAULT_MANAGER_PULSE_SETTINGS,
    sync: { ...DEFAULT_MANAGER_PULSE_SETTINGS.sync, ...sync },
  };
}

function makeJob(overrides: Partial<LeagueSyncJob> = {}): LeagueSyncJob {
  return {
    id: `job-${Math.random().toString(36).slice(2)}`,
    attempts: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    duration_ms: null,
    finished_at: null,
    job_kind: "pulse",
    last_error: null,
    league_name: null,
    manager_run_id: null,
    request_id: null,
    run_after: "2026-01-01T00:00:00.000Z",
    sleeper_calls: null,
    sleeper_league_id: "L1",
    status: "processing",
    updated_at: "2026-01-01T00:00:00.000Z",
    user_id: "user-1",
    ...overrides,
  } as unknown as LeagueSyncJob;
}

beforeEach(() => {
  _resetSleeperBudgetForTests(100_000);
  mockPulseLeagueDerived.mockResolvedValue({ transactions: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  _resetSleeperBudgetForTests();
});

/* -------------------------------------------------------------------------- */
/* A bespoke fake admin for the checkpoint-pacing test below. Its            */
/* manager_pulse_runs table needs to answer two DIFFERENT query shapes       */
/* (a single row by id via maybeSingle, and a filtered list of 'computing'   */
/* runs), which the generic makeFakeAdmin/makeChain helpers above cannot     */
/* tell apart, so this one inspects which column .eq() filtered on.         */
/* -------------------------------------------------------------------------- */

type PacingRun = {
  status: string;
  leagues_done: number;
  live_checkpoint_done: number;
  live_checkpoint_at: string | null;
};

function simpleChain(resolve: () => FakeResponse) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    lt: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(resolve()),
    then: (onOk: (v: FakeResponse) => unknown, onErr: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onOk, onErr),
  };
  return chain;
}

/**
 * One Manager Pulse run ("run-1") that never leaves 'capturing' (its
 * manager_pulse_run_leagues rows always include one 'pending', so
 * recountManagerPulseRun never flips it to 'computing'), fed jobs one at a
 * time so runLeagueSyncWorker's claim loop runs one batch per job.
 */
function makeCheckpointPacingAdmin(jobs: LeagueSyncJob[]) {
  const queue = [...jobs];
  let jobsSettled = 0;
  const run: PacingRun = {
    status: "capturing",
    leagues_done: 0,
    live_checkpoint_done: 0,
    live_checkpoint_at: null,
  };

  const admin = {
    from(table: string) {
      if (table === "league_sync_jobs") {
        return {
          select: () => simpleChain(() => ({ data: [], error: null })),
          update: () => simpleChain(() => ({ data: [{ id: "won" }], error: null })),
        };
      }
      if (table === "manager_pulse_run_leagues") {
        return {
          update: () => {
            jobsSettled += 1;
            return simpleChain(() => ({ data: [{ run_id: "run-1" }], error: null }));
          },
          select: () =>
            simpleChain(() => ({
              data: [
                ...Array.from({ length: jobsSettled }, () => ({ status: "done" })),
                // Keeps stillWorking true in recountManagerPulseRun, so this
                // run stays 'capturing' for the whole test.
                { status: "pending" },
              ],
              error: null,
            })),
        };
      }
      if (table === "manager_pulse_runs") {
        return {
          select: () => {
            let byId = false;
            const chain: Record<string, unknown> = {
              select: () => chain,
              eq: (field: string) => {
                if (field === "id") byId = true;
                return chain;
              },
              is: () => chain,
              order: () => chain,
              limit: () => chain,
              maybeSingle: () => Promise.resolve({ data: byId ? { ...run } : null, error: null }),
              // A plain (non-maybeSingle) select is finalizeComputingRuns'
              // status='computing' list query; this run is always
              // 'capturing', so it never matches.
              then: (onOk: (v: FakeResponse) => unknown, onErr: (e: unknown) => unknown) =>
                Promise.resolve({ data: [], error: null }).then(onOk, onErr),
            };
            return chain;
          },
          update: (payload: Record<string, unknown>) => {
            Object.assign(run, payload);
            return simpleChain(() => ({ data: [{ id: "run-1" }], error: null }));
          },
        };
      }
      throw new Error(`checkpoint pacing test: no handler for table ${table}`);
    },
    rpc(name: string) {
      if (name === "try_acquire_league_sync_lease") return Promise.resolve({ data: true, error: null });
      if (name === "claim_league_sync_jobs") {
        const next = queue.shift();
        return Promise.resolve({ data: next ? [next] : [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  return { admin: admin as unknown as SupabaseClient<Database>, run };
}

describe("runLeagueSyncWorker", () => {
  it("runs jobConcurrency 2 jobs at once, never more, across three jobs", async () => {
    mockLoadSettings.mockResolvedValue(buildSettings({ jobConcurrency: 2, jobsPerClaim: 12, passBudgetSeconds: 60, maxCallsPerPass: 2400 }));

    let inFlight = 0;
    let peak = 0;
    mockPulseLeagueCore.mockImplementation(async (_admin, sleeperLeagueId: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return {
        ok: true,
        leagueRowId: `row-${sleeperLeagueId}`,
        sleeperLeagueId,
        season: 2026,
        cached: false,
        counts: { rosters: 0, users: 0 },
      };
    });

    const jobs = [makeJob({ sleeper_league_id: "L1" }), makeJob({ sleeper_league_id: "L2" }), makeJob({ sleeper_league_id: "L3" })];
    const { admin } = makeFakeAdmin({
      tableHandlers: baseTableHandlers(),
      rpcHandler: makeRpcHandler({ leaseOk: true, jobs }),
    });

    const summary = await runLeagueSyncWorker(admin, { holder: "test-holder" });

    expect(peak).toBe(2);
    expect(summary.done).toBe(3);
    expect(summary.claimed).toBe(3);
  });

  it("releases a job that is reached only after the pass deadline", async () => {
    vi.useFakeTimers();
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(start);

    // jobConcurrency 1 so jobs run strictly in sequence: the first job's mock
    // pushes the fake clock past the deadline, so the second job (reached only
    // after the first completes) is released rather than run.
    mockLoadSettings.mockResolvedValue(buildSettings({ jobConcurrency: 1, jobsPerClaim: 12, passBudgetSeconds: 1, maxCallsPerPass: 2400 }));

    mockPulseLeagueCore.mockImplementation(async (_admin, sleeperLeagueId: string) => {
      if (sleeperLeagueId === "L1") {
        // Push well past the one-second pass deadline before this job settles.
        vi.advanceTimersByTime(5_000);
      }
      return {
        ok: true,
        leagueRowId: `row-${sleeperLeagueId}`,
        sleeperLeagueId,
        season: 2026,
        cached: false,
        counts: { rosters: 0, users: 0 },
      };
    });

    const jobs = [makeJob({ sleeper_league_id: "L1" }), makeJob({ sleeper_league_id: "L2" })];
    const { admin } = makeFakeAdmin({
      tableHandlers: baseTableHandlers(),
      rpcHandler: makeRpcHandler({ leaseOk: true, jobs }),
    });

    const summary = await runLeagueSyncWorker(admin, { holder: "test-holder" });

    expect(summary.done).toBe(1);
    expect(summary.released).toBe(1);
  });

  it("counts Sleeper calls made across jobs into the summary", async () => {
    mockLoadSettings.mockResolvedValue(buildSettings({ jobConcurrency: 2, jobsPerClaim: 12, passBudgetSeconds: 60, maxCallsPerPass: 2400 }));

    mockPulseLeagueCore.mockImplementation(async (_admin, sleeperLeagueId: string) => {
      await acquireSleeperToken();
      await acquireSleeperToken();
      return {
        ok: true,
        leagueRowId: `row-${sleeperLeagueId}`,
        sleeperLeagueId,
        season: 2026,
        cached: false,
        counts: { rosters: 0, users: 0 },
      };
    });

    const jobs = [makeJob({ sleeper_league_id: "L1" }), makeJob({ sleeper_league_id: "L2" })];
    const { admin, updateCalls } = makeFakeAdmin({
      tableHandlers: baseTableHandlers(),
      rpcHandler: makeRpcHandler({ leaseOk: true, jobs }),
    });

    const summary = await runLeagueSyncWorker(admin, { holder: "test-holder" });

    expect(summary.callsMade).toBe(4);
    expect(summary.done).toBe(2);

    const doneUpdates = updateCalls.filter(
      (c) => c.table === "league_sync_jobs" && c.payload.status === "done",
    );
    expect(doneUpdates).toHaveLength(2);
    for (const call of doneUpdates) {
      expect(call.payload.sleeper_calls).toBe(2);
      expect(typeof call.payload.duration_ms).toBe("number");
    }
  });

  it("stops claiming once a lease renewal returns false", async () => {
    mockLoadSettings.mockResolvedValue(buildSettings({ jobConcurrency: 2, jobsPerClaim: 12, passBudgetSeconds: 60, maxCallsPerPass: 2400 }));

    const jobs = [makeJob({ sleeper_league_id: "L1" })];
    const { admin, rpcCalls } = makeFakeAdmin({
      tableHandlers: baseTableHandlers(),
      rpcHandler: makeRpcHandler({ leaseOk: false, jobs }),
    });

    const summary = await runLeagueSyncWorker(admin, { holder: "test-holder" });

    expect(summary.claimed).toBe(0);
    expect(mockPulseLeagueCore).not.toHaveBeenCalled();
    const claimCalls = rpcCalls.filter((c) => c.name === "claim_league_sync_jobs");
    expect(claimCalls).toHaveLength(0);
    const leaseCalls = rpcCalls.filter((c) => c.name === "try_acquire_league_sync_lease");
    expect(leaseCalls.length).toBeGreaterThan(0);
  });

  it("fires more than one live-report checkpoint in a single pass, but not before its own growing gap elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-01-01T00:00:00.000Z"));

    mockLoadSettings.mockResolvedValue(
      buildSettings({
        jobConcurrency: 1,
        jobsPerClaim: 1,
        passBudgetSeconds: 1000,
        maxCallsPerPass: 2400,
        liveReportFirstAfter: 1,
        liveReportEveryLeagues: 5,
        liveReportMinIntervalMs: 20_000,
      }),
    );

    // shouldComputeLiveReport is forced to always say "due", isolating this
    // test to league-bulk-sync's OWN gate (checkpointGapMs): if that gate is
    // missing or broken, every one of these three settles would compute a
    // checkpoint, since the imported gate alone never says no here.
    mockShouldComputeLiveReport.mockReturnValue(true);
    mockComputeLiveReport.mockImplementation(async (_admin: unknown, _runId: string) => {
      // Mirrors what the real computeLiveReport writes back onto the run
      // row: this run's coverage right now becomes its checkpoint.
      run.live_checkpoint_done = run.leagues_done;
      run.live_checkpoint_at = new Date().toISOString();
    });

    // L2 arrives 5s after L1 settles; L3 arrives 25s after that (30s total).
    // A fixed liveReportMinIntervalMs of 20s would allow a repeat checkpoint
    // at L2 already; the growing gap must not.
    mockPulseLeagueCore.mockImplementation(async (_admin, sleeperLeagueId: string) => {
      if (sleeperLeagueId === "L2") vi.advanceTimersByTime(5_000);
      if (sleeperLeagueId === "L3") vi.advanceTimersByTime(25_000);
      return {
        ok: true,
        leagueRowId: `row-${sleeperLeagueId}`,
        sleeperLeagueId,
        season: 2026,
        cached: false,
        counts: { rosters: 0, users: 0 },
      };
    });

    const jobs = [
      makeJob({ sleeper_league_id: "L1", manager_run_id: "run-1", request_id: null }),
      makeJob({ sleeper_league_id: "L2", manager_run_id: "run-1", request_id: null }),
      makeJob({ sleeper_league_id: "L3", manager_run_id: "run-1", request_id: null }),
    ];
    const { admin, run } = makeCheckpointPacingAdmin(jobs);

    const summary = await runLeagueSyncWorker(admin, { holder: "test-holder" });

    expect(summary.done).toBe(3);
    // One checkpoint for crossing leaguesDone >= liveReportFirstAfter (at
    // L1), and exactly one repeat checkpoint (at L3, once the grown gap since
    // L1's checkpoint has actually elapsed): NOT a checkpoint at L2, where
    // only 5s had passed. Two total, not three, is the pacing fix working:
    // the old once-per-pass code would also have produced a small number
    // here by accident (it never looked more than once), so the assertion
    // that matters is WHICH settle produced the second one.
    expect(summary.liveReports).toBe(2);
    expect(mockComputeLiveReport).toHaveBeenCalledTimes(2);
    expect(run.live_checkpoint_done).toBe(3);
  });
});
