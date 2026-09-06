import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

vi.mock("@/lib/sleeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sleeper")>();
  return {
    ...actual,
    getSleeperUser: vi.fn(),
    getSleeperLeaguesOrNull: vi.fn(),
    currentNflSeason: vi.fn(() => "2026"),
  };
});

vi.mock("./rate-limit", () => ({
  claimManagerLookupSlot: vi.fn(),
}));

vi.mock("next/server", () => ({
  // Invokes the callback synchronously so a test's single `await
  // startManagerCapture(...)` observes whatever the callback did, matching
  // MPS-T003's testing note.
  after: vi.fn((cb: () => unknown) => {
    void cb();
  }),
}));

vi.mock("@/lib/league-sync-wake", () => ({
  wakeLeagueSyncWorker: vi.fn(),
}));

import { getSleeperLeaguesOrNull, getSleeperUser } from "@/lib/sleeper";
import { claimManagerLookupSlot } from "./rate-limit";
import { wakeLeagueSyncWorker } from "@/lib/league-sync-wake";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import { findOpenRun, readCaptureProgress, startManagerCapture } from "./capture";
import type { ManagerPulseSettings } from "./types";

const mockGetSleeperUser = vi.mocked(getSleeperUser);
const mockGetSleeperLeagues = vi.mocked(getSleeperLeaguesOrNull);
const mockClaimLookup = vi.mocked(claimManagerLookupSlot);
const mockWakeWorker = vi.mocked(wakeLeagueSyncWorker);

/* -------------------------------------------------------------------------- */
/* A minimal fake PostgREST + RPC client                                      */
/* -------------------------------------------------------------------------- */

type FakeResponse = { data: unknown; error: unknown; count?: number };
type RpcCall = { name: string; args: unknown };

type FakeAdminHandlers = {
  leagues?: () => FakeResponse;
  managerPulseRun?: () => FakeResponse;
  managerPulseRunLeagues?: () => FakeResponse;
  leagueSyncJobs?: () => FakeResponse;
  managerPulseLiveReports?: () => FakeResponse;
  rpc?: (name: string, args: unknown) => FakeResponse;
};

function makeFakeAdmin(handlers: FakeAdminHandlers) {
  const rpcCalls: RpcCall[] = [];

  class Builder implements PromiseLike<FakeResponse> {
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
    gte() {
      return this;
    }
    lt() {
      return this;
    }
    not() {
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
    rpcCalls,
    from(table: string) {
      const resolver =
        table === "leagues"
          ? handlers.leagues
          : table === "manager_pulse_runs"
            ? handlers.managerPulseRun
            : table === "manager_pulse_run_leagues"
              ? handlers.managerPulseRunLeagues
              : table === "league_sync_jobs"
                ? handlers.leagueSyncJobs
                : table === "manager_pulse_live_reports"
                  ? handlers.managerPulseLiveReports
                  : undefined;
      if (!resolver) throw new Error(`fake admin: no handler for table ${table}`);
      return { select: () => new Builder(resolver) };
    },
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      const result = handlers.rpc ? handlers.rpc(name, args) : { data: null, error: null };
      return Promise.resolve(result);
    },
  };

  return admin as unknown as SupabaseClient<Database> & { rpcCalls: RpcCall[] };
}

const NOW_ISO = "2026-09-04T00:00:00.000Z";

function freshRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: {
      id: "run-1",
      status: "computing",
      requested_at: NOW_ISO,
      sleeper_user_id: "sleeper-1",
      season_from: 2023,
      season_to: 2026,
      leagues_total: 1,
      leagues_done: 1,
      leagues_failed: 0,
      detail: null,
      ...overrides,
    },
    error: null,
  };
}

function runLeagueRows(statuses: string[]) {
  return { data: statuses.map((status) => ({ status })), error: null };
}

/** No live-report row: partialVersion reads back as 0. */
function noLiveReport(): FakeResponse {
  return { data: null, error: null };
}

beforeEach(() => {
  mockGetSleeperUser.mockReset();
  mockGetSleeperLeagues.mockReset();
  mockClaimLookup.mockReset();
  mockWakeWorker.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
});

afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* startManagerCapture                                                        */
/* -------------------------------------------------------------------------- */

describe("startManagerCapture", () => {
  it("rejects an invalid handle before any network call or rate-limit spend", async () => {
    const admin = makeFakeAdmin({});

    const result = await startManagerCapture({
      admin,
      userId: "user-1",
      handle: "Not A Valid Handle!",
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    });

    expect(result).toEqual({ status: "not_found" });
    expect(mockGetSleeperUser).not.toHaveBeenCalled();
    expect(mockClaimLookup).not.toHaveBeenCalled();
  });

  /*
   * A WELL-FORMED HANDLE COSTS A SLOT EVEN WHEN SLEEPER HAS NEVER HEARD OF IT.
   *
   * This test asserted the opposite until a security review pointed out what
   * that bought an attacker: resolving a handle is the one outbound,
   * enumerable, third-party request on this path, and leaving it free meant a
   * signed-in reader could walk a wordlist through the report route, learn
   * which handles exist, and point the site's whole egress at Sleeper while
   * they did it. Shape validation still runs first and is still free (the test
   * above), so garbage costs nothing. A plausible guess is not garbage.
   */
  it("spends a rate-limit slot on a well-formed handle Sleeper does not recognize", async () => {
    mockGetSleeperUser.mockResolvedValue(null);
    mockClaimLookup.mockResolvedValue({ ok: true });
    const admin = makeFakeAdmin({});

    const result = await startManagerCapture({
      admin,
      userId: "user-1",
      handle: "nobody_here",
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    });

    expect(result).toEqual({ status: "not_found" });
    expect(mockClaimLookup).toHaveBeenCalledTimes(1);
  });

  /*
   * The caller that already resolved the handle already paid for it. Charging
   * again would meter one lookup twice and halve every reader's real budget.
   */
  it("does not claim a second slot when the caller passes an already-resolved subject", async () => {
    mockGetSleeperLeagues.mockResolvedValue([]);
    const admin = makeFakeAdmin({});

    await startManagerCapture({
      admin,
      userId: "user-1",
      handle: "someone",
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
      resolved: { sleeperUserId: "u1", handle: "someone", avatarUrl: null },
    });

    expect(mockClaimLookup).not.toHaveBeenCalled();
    expect(mockGetSleeperUser).not.toHaveBeenCalled();
  });

  it("returns throttled when the lookup rate limit refuses", async () => {
    mockGetSleeperUser.mockResolvedValue({
      user_id: "u1",
      username: "testuser",
      display_name: "Test",
      avatar: null,
    });
    mockClaimLookup.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });
    const admin = makeFakeAdmin({});

    const result = await startManagerCapture({
      admin,
      userId: "user-1",
      handle: "testuser",
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    });

    expect(result).toEqual({ status: "throttled", retryAfterSeconds: 60 });
  });

  it("returns empty when discovery finds no league-seasons", async () => {
    mockGetSleeperUser.mockResolvedValue({
      user_id: "u1",
      username: "testuser",
      display_name: "Test",
      avatar: null,
    });
    mockClaimLookup.mockResolvedValue({ ok: true });
    mockGetSleeperLeagues.mockResolvedValue([]);
    const admin = makeFakeAdmin({});

    const result = await startManagerCapture({
      admin,
      userId: "user-1",
      handle: "testuser",
      seasons: 1,
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    });

    expect(result).toEqual({ status: "empty" });
  });

  /*
   * F4/MPS-T008: a season Sleeper never answered for is not a season with no
   * leagues. `discoverLeagueSeasons` reports it back via `failedSeasons`, and
   * this must be refused BEFORE any run is claimed: a 429 on one season must
   * not spend the reader's budget on a report that would be missing a whole
   * season's evidence.
   */
  it("returns error and claims no run when a season fails to load", async () => {
    mockGetSleeperUser.mockResolvedValue({
      user_id: "u1",
      username: "testuser",
      display_name: "Test",
      avatar: null,
    });
    mockClaimLookup.mockResolvedValue({ ok: true });
    mockGetSleeperLeagues.mockResolvedValue(null); // the one requested season failed
    const admin = makeFakeAdmin({});

    const result = await startManagerCapture({
      admin,
      userId: "user-1",
      handle: "testuser",
      seasons: 1,
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    });

    expect(result.status).toBe("error");
    expect(admin.rpcCalls.find((c) => c.name === "try_claim_manager_pulse")).toBeUndefined();
  });

  it("returns throttled with the used/total figures on a budget reply from try_claim_manager_pulse", async () => {
    mockGetSleeperUser.mockResolvedValue({
      user_id: "u1",
      username: "testuser",
      display_name: "Test",
      avatar: null,
    });
    mockClaimLookup.mockResolvedValue({ ok: true });
    mockGetSleeperLeagues.mockResolvedValue([
      {
        league_id: "L1",
        name: "League One",
        season: "2026",
        sport: "nfl",
        status: "in_season",
        total_rosters: 12,
        settings: { type: 0 },
        previous_league_id: null,
      },
    ]);

    const admin = makeFakeAdmin({
      leagues: () => ({ data: [], error: null }),
      rpc: (name) => {
        if (name === "try_claim_manager_pulse") {
          return {
            data: {
              claimed: false,
              reason: "budget",
              budget_used: 140,
              budget_total: 150,
              retry_after_seconds: 900,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    });

    const result = await startManagerCapture({
      admin,
      userId: "user-1",
      handle: "testuser",
      seasons: 1,
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    });

    expect(result).toEqual({
      status: "throttled",
      retryAfterSeconds: 900,
      budgetUsed: 140,
      budgetTotal: 150,
    });
  });

  it("skips the enqueue RPC and just reads progress on a resumed claim", async () => {
    mockGetSleeperUser.mockResolvedValue({
      user_id: "u1",
      username: "testuser",
      display_name: "Test",
      avatar: null,
    });
    mockClaimLookup.mockResolvedValue({ ok: true });
    mockGetSleeperLeagues.mockResolvedValue([
      {
        league_id: "L1",
        name: "League One",
        season: "2026",
        sport: "nfl",
        status: "in_season",
        total_rosters: 12,
        settings: { type: 0 },
        previous_league_id: null,
      },
    ]);

    const admin = makeFakeAdmin({
      leagues: () => ({ data: [], error: null }),
      managerPulseRun: () => freshRun({ status: "capturing", leagues_total: 1, leagues_done: 0 }),
      managerPulseRunLeagues: () => runLeagueRows(["queued"]),
      managerPulseLiveReports: noLiveReport,
      rpc: (name) => {
        if (name === "try_claim_manager_pulse") {
          return { data: { claimed: true, run_id: "run-1", resumed: true }, error: null };
        }
        return { data: null, error: null };
      },
    });

    const result = await startManagerCapture({
      admin,
      userId: "user-1",
      handle: "testuser",
      seasons: 1,
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    });

    expect(result.status).toBe("started");
    expect(admin.rpcCalls.find((c) => c.name === "enqueue_manager_pulse_capture")).toBeUndefined();
  });

  it("still creates a run and returns progress when every league is already fresh", async () => {
    mockGetSleeperUser.mockResolvedValue({
      user_id: "u1",
      username: "testuser",
      display_name: "Test",
      avatar: null,
    });
    mockClaimLookup.mockResolvedValue({ ok: true });
    mockGetSleeperLeagues.mockResolvedValue([
      {
        league_id: "L1",
        name: "League One",
        season: "2026",
        sport: "nfl",
        status: "in_season",
        total_rosters: 12,
        settings: { type: 0 },
        previous_league_id: null,
      },
    ]);

    const admin = makeFakeAdmin({
      leagues: () => ({
        data: [{ sleeper_league_id: "L1", capture_completed_at: NOW_ISO, status: "complete", season: 2026 }],
        error: null,
      }),
      managerPulseRun: () => freshRun({ status: "computing", leagues_total: 1, leagues_done: 1 }),
      managerPulseRunLeagues: () => runLeagueRows(["fresh"]),
      managerPulseLiveReports: noLiveReport,
      rpc: (name) => {
        if (name === "try_claim_manager_pulse") {
          return { data: { claimed: true, run_id: "run-1" }, error: null };
        }
        if (name === "enqueue_manager_pulse_capture") {
          return { data: { leagues: 1, queued: 0, fresh: 1, linked: 0 }, error: null };
        }
        return { data: null, error: null };
      },
    });

    const result = await startManagerCapture({
      admin,
      userId: "user-1",
      handle: "testuser",
      seasons: 1,
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    });

    expect(result.status).toBe("warm");
    if (result.status !== "warm") throw new Error("expected warm");
    expect(result.runId).toBe("run-1");
    expect(result.progress.leaguesTotal).toBe(1);
    expect(result.progress.leaguesDone).toBe(1);
    expect(result.progress.leaguesFailed).toBe(0);

    // A settled, complete league-season is never re-captured, so the RPC was
    // told it needed nothing and asked for a budget of zero.
    const claimCall = admin.rpcCalls.find((c) => c.name === "try_claim_manager_pulse");
    expect((claimCall!.args as { p_leagues_requested: number }).p_leagues_requested).toBe(0);

    const enqueueCall = admin.rpcCalls.find((c) => c.name === "enqueue_manager_pulse_capture");
    const payload = enqueueCall?.args as { p_leagues: Array<{ needs_capture: boolean }> };
    expect(payload.p_leagues[0].needs_capture).toBe(false);
  });

  it("decides freshness from the captureStaleAfterDays setting, not a hardcoded number", async () => {
    mockGetSleeperUser.mockResolvedValue({
      user_id: "u1",
      username: "testuser",
      display_name: "Test",
      avatar: null,
    });
    mockClaimLookup.mockResolvedValue({ ok: true });
    mockGetSleeperLeagues.mockResolvedValue([
      {
        league_id: "L1",
        name: "League One",
        season: "2026",
        sport: "nfl",
        status: "in_season",
        total_rosters: 12,
        settings: { type: 0 },
        previous_league_id: null,
      },
    ]);

    // An UNSETTLED league-season (current season, not Sleeper-complete) last
    // captured 20 days ago.
    const twentyDaysAgo = new Date(Date.parse(NOW_ISO) - 20 * 86_400_000).toISOString();

    async function run(captureStaleAfterDays: number): Promise<boolean> {
      const settings: ManagerPulseSettings = {
        ...DEFAULT_MANAGER_PULSE_SETTINGS,
        capture: { ...DEFAULT_MANAGER_PULSE_SETTINGS.capture, captureStaleAfterDays },
      };
      const admin = makeFakeAdmin({
        leagues: () => ({
          data: [
            { sleeper_league_id: "L1", capture_completed_at: twentyDaysAgo, status: "in_season", season: 2026 },
          ],
          error: null,
        }),
        managerPulseRun: () => freshRun(),
        managerPulseRunLeagues: () => runLeagueRows(["fresh"]),
        managerPulseLiveReports: noLiveReport,
        rpc: (name) => {
          if (name === "try_claim_manager_pulse") {
            return { data: { claimed: true, run_id: "run-1" }, error: null };
          }
          if (name === "enqueue_manager_pulse_capture") {
            return { data: { leagues: 1, queued: 0, fresh: 1, linked: 0 }, error: null };
          }
          return { data: null, error: null };
        },
      });

      await startManagerCapture({
        admin,
        userId: "user-1",
        handle: "testuser",
        seasons: 1,
        settings,
      });

      const enqueueCall = admin.rpcCalls.find((c) => c.name === "enqueue_manager_pulse_capture");
      const payload = enqueueCall?.args as { p_leagues: Array<{ needs_capture: boolean }> };
      return payload.p_leagues[0].needs_capture;
    }

    // 14-day stale window: a league captured 20 days ago is stale.
    expect(await run(14)).toBe(true);

    // 30-day stale window: the same 20-day-old capture is now still fresh.
    expect(await run(30)).toBe(false);
  });

  /*
   * MPS-T003: wake the worker after queueing, but only when there is
   * something for it to drain right now.
   */
  describe("waking the sync worker", () => {
    function wakeHandlers(overrides: {
      enqueue: { leagues: number; queued: number; fresh: number; linked: number };
      runStatus: string;
      runLeagueStatuses: string[];
    }) {
      return {
        leagues: () => ({ data: [], error: null }),
        managerPulseRun: () =>
          freshRun({
            status: overrides.runStatus,
            leagues_total: overrides.runLeagueStatuses.length,
            leagues_done: 0,
          }),
        managerPulseRunLeagues: () => runLeagueRows(overrides.runLeagueStatuses),
        managerPulseLiveReports: noLiveReport,
        rpc: (name: string) => {
          if (name === "try_claim_manager_pulse") {
            return { data: { claimed: true, run_id: "run-1" }, error: null };
          }
          if (name === "enqueue_manager_pulse_capture") {
            return { data: overrides.enqueue, error: null };
          }
          return { data: null, error: null };
        },
      };
    }

    it("wakes the worker once when the enqueue reports queued leagues", async () => {
      mockGetSleeperUser.mockResolvedValue({
        user_id: "u1",
        username: "testuser",
        display_name: "Test",
        avatar: null,
      });
      mockClaimLookup.mockResolvedValue({ ok: true });
      mockGetSleeperLeagues.mockResolvedValue([
        {
          league_id: "L1",
          name: "League One",
          season: "2026",
          sport: "nfl",
          status: "in_season",
          total_rosters: 12,
          settings: { type: 0 },
          previous_league_id: null,
        },
      ]);
      const admin = makeFakeAdmin(
        wakeHandlers({
          enqueue: { leagues: 1, queued: 2, fresh: 0, linked: 0 },
          runStatus: "capturing",
          runLeagueStatuses: ["queued", "queued"],
        }),
      );

      await startManagerCapture({
        admin,
        userId: "user-1",
        handle: "testuser",
        seasons: 1,
        settings: DEFAULT_MANAGER_PULSE_SETTINGS,
      });

      expect(mockWakeWorker).toHaveBeenCalledTimes(1);
      expect(mockWakeWorker).toHaveBeenCalledWith("manager-pulse-enqueue");
    });

    it("does not wake the worker when nothing was queued and the run is still capturing", async () => {
      mockGetSleeperUser.mockResolvedValue({
        user_id: "u1",
        username: "testuser",
        display_name: "Test",
        avatar: null,
      });
      mockClaimLookup.mockResolvedValue({ ok: true });
      mockGetSleeperLeagues.mockResolvedValue([
        {
          league_id: "L1",
          name: "League One",
          season: "2026",
          sport: "nfl",
          status: "in_season",
          total_rosters: 12,
          settings: { type: 0 },
          previous_league_id: null,
        },
      ]);
      const admin = makeFakeAdmin(
        wakeHandlers({
          // Linked to an already in-flight job for another user: nothing new
          // was queued, and the run has real work still ahead of it.
          enqueue: { leagues: 1, queued: 0, fresh: 0, linked: 1 },
          runStatus: "capturing",
          runLeagueStatuses: ["queued"],
        }),
      );

      await startManagerCapture({
        admin,
        userId: "user-1",
        handle: "testuser",
        seasons: 1,
        settings: DEFAULT_MANAGER_PULSE_SETTINGS,
      });

      expect(mockWakeWorker).not.toHaveBeenCalled();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* readCaptureProgress                                                        */
/* -------------------------------------------------------------------------- */

describe("readCaptureProgress", () => {
  it("prefers the live grouped count over the run row's cached counters", async () => {
    const admin = makeFakeAdmin({
      managerPulseRun: () =>
        freshRun({ status: "capturing", leagues_total: 3, leagues_done: 0, leagues_failed: 0 }),
      managerPulseRunLeagues: () => runLeagueRows(["done", "fresh", "failed"]),
      managerPulseLiveReports: noLiveReport,
    });

    const progress = await readCaptureProgress(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS);

    expect(progress).not.toBeNull();
    expect(progress?.leaguesDone).toBe(2);
    expect(progress?.leaguesFailed).toBe(1);
  });

  it("falls back to the run row's own counters when the grouped read fails", async () => {
    const admin = makeFakeAdmin({
      managerPulseRun: () =>
        freshRun({ status: "capturing", leagues_total: 3, leagues_done: 1, leagues_failed: 0 }),
      managerPulseRunLeagues: () => ({ data: null, error: { message: "boom" } }),
      managerPulseLiveReports: noLiveReport,
    });

    const progress = await readCaptureProgress(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS);

    expect(progress?.leaguesDone).toBe(1);
    expect(progress?.leaguesFailed).toBe(0);
  });

  it("returns null, never throws, when the run does not exist", async () => {
    const admin = makeFakeAdmin({
      managerPulseRun: () => ({ data: null, error: null }),
      managerPulseRunLeagues: () => runLeagueRows([]),
    });

    const progress = await readCaptureProgress(admin, "missing-run", DEFAULT_MANAGER_PULSE_SETTINGS);
    expect(progress).toBeNull();
  });

  /*
   * MPS-T020: the five new fields, all counted from the linked jobs and the
   * live-report cache rather than from the run row's own (laggier) counters.
   */
  it("computes requestedAt, leaguesProcessing, queueAhead, workerSeenAt and partialVersion", async () => {
    const admin = makeFakeAdmin({
      managerPulseRun: () =>
        freshRun({ status: "capturing", leagues_total: 3, leagues_done: 0, leagues_failed: 0 }),
      managerPulseRunLeagues: () => ({
        data: [
          { status: "queued", job_id: "job-1" },
          { status: "pending", job_id: "job-2" },
          { status: "done", job_id: null },
        ],
        error: null,
      }),
      leagueSyncJobs: () => ({
        data: [
          {
            status: "processing",
            updated_at: "2026-09-04T00:05:00.000Z",
            created_at: "2026-09-03T23:00:00.000Z",
          },
          {
            status: "pending",
            updated_at: "2026-09-03T23:50:00.000Z",
            created_at: "2026-09-03T23:50:00.000Z",
          },
        ],
        error: null,
        count: 4,
      }),
      managerPulseLiveReports: () => ({ data: { version: 3 }, error: null }),
    });

    const progress = await readCaptureProgress(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS);

    expect(progress).not.toBeNull();
    expect(progress?.requestedAt).toBe(NOW_ISO);
    expect(progress?.leaguesProcessing).toBe(1);
    expect(progress?.workerSeenAt).toBe("2026-09-04T00:05:00.000Z");
    expect(progress?.queueAhead).toBe(4);
    expect(progress?.partialVersion).toBe(3);
  });

  it("reports zero processing, no queueAhead and partialVersion 0 when no job is linked", async () => {
    const admin = makeFakeAdmin({
      managerPulseRun: () => freshRun({ status: "computing" }),
      managerPulseRunLeagues: () => runLeagueRows(["fresh", "done"]),
      managerPulseLiveReports: noLiveReport,
    });

    const progress = await readCaptureProgress(admin, "run-1", DEFAULT_MANAGER_PULSE_SETTINGS);

    expect(progress?.leaguesProcessing).toBe(0);
    expect(progress?.queueAhead).toBe(0);
    expect(progress?.workerSeenAt).toBeNull();
    expect(progress?.partialVersion).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Admin throttle bypass                                                      */
/* -------------------------------------------------------------------------- */

/*
 * The bypass exists so the person who owns the tool can actually exercise it:
 * an hourly budget makes testing a report impossible. It is deliberately
 * narrow, and these tests are what keep it narrow. It skips the lookup slot and
 * passes an effectively unlimited league budget, and it changes NOTHING else.
 * In particular it must not widen maxLeaguesPerRun, because that is a cost
 * control rather than a convenience, and an admin who could queue an unbounded
 * run would be able to point the whole site's sync drain at one lookup.
 */
describe("startManagerCapture admin throttle bypass", () => {
  const subject = {
    sleeperUserId: "u-subject",
    handle: "somebody",
    avatarUrl: null,
  };

  /** Enough of a fake for capture to reach the two RPCs these tests inspect. */
  function bypassHandlers() {
    return {
      leagues: () => ({ data: [], error: null }),
      managerPulseRun: () => freshRun(),
      managerPulseRunLeagues: () => runLeagueRows(["fresh"]),
      managerPulseLiveReports: noLiveReport,
      rpc: (name: string) => {
        if (name === "try_claim_manager_pulse") {
          return { data: { claimed: true, run_id: "run-1" }, error: null };
        }
        return { data: { leagues: 1, queued: 0, fresh: 1, linked: 0 }, error: null };
      },
    };
  }

  const oneLeague = [
    {
      league_id: "L1",
      name: "League One",
      season: "2026",
      sport: "nfl",
      status: "in_season",
      total_rosters: 12,
      settings: { type: 0 },
      previous_league_id: null,
    },
  ];

  it("claims no lookup slot and passes an unrestricted budget", async () => {
    mockGetSleeperLeagues.mockResolvedValue(oneLeague);
    const admin = makeFakeAdmin(bypassHandlers());

    await startManagerCapture({
      admin,
      userId: "admin-1",
      handle: "somebody",
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
      bypassThrottle: true,
      resolved: subject,
    });

    expect(mockClaimLookup).not.toHaveBeenCalled();
    const claim = admin.rpcCalls.find((c) => c.name === "try_claim_manager_pulse");
    expect(claim).toBeDefined();
    const args = claim!.args as { p_league_budget: number; p_budget_window_seconds: number };
    expect(args.p_league_budget).toBeGreaterThan(DEFAULT_MANAGER_PULSE_SETTINGS.capture.leaguesPerUserPerHour);
    expect(args.p_budget_window_seconds).toBe(3600);
  });

  it("passes the real per-hour budget when the bypass is off", async () => {
    mockGetSleeperLeagues.mockResolvedValue(oneLeague);
    const admin = makeFakeAdmin(bypassHandlers());

    await startManagerCapture({
      admin,
      userId: "reader-1",
      handle: "somebody",
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
      resolved: subject,
    });

    const claim = admin.rpcCalls.find((c) => c.name === "try_claim_manager_pulse");
    expect((claim!.args as { p_league_budget: number }).p_league_budget).toBe(
      DEFAULT_MANAGER_PULSE_SETTINGS.capture.leaguesPerUserPerHour,
    );
  });

  it("does not widen the league cap for an admin", async () => {
    mockGetSleeperLeagues.mockResolvedValue(oneLeague);
    const admin = makeFakeAdmin(bypassHandlers());

    await startManagerCapture({
      admin,
      userId: "admin-1",
      handle: "somebody",
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
      bypassThrottle: true,
      resolved: subject,
    });

    const enqueue = admin.rpcCalls.find((c) => c.name === "enqueue_manager_pulse_capture");
    if (enqueue) {
      expect((enqueue.args as { p_max_leagues: number }).p_max_leagues).toBe(
        DEFAULT_MANAGER_PULSE_SETTINGS.capture.maxLeaguesPerRun,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* findOpenRun                                                                */
/* -------------------------------------------------------------------------- */

describe("findOpenRun", () => {
  const SUBJECT = {
    userId: "user-1",
    sleeperUserId: "sleeper-1",
    seasonFrom: 2023,
    seasonTo: 2026,
    settings: DEFAULT_MANAGER_PULSE_SETTINGS,
  };

  it("returns the run and its live progress when one is still open", async () => {
    const admin = makeFakeAdmin({
      managerPulseRun: () => freshRun({ status: "capturing", leagues_total: 4 }),
      managerPulseRunLeagues: () => runLeagueRows(["done", "done", "queued", "failed"]),
      managerPulseLiveReports: noLiveReport,
    });

    const found = await findOpenRun(admin, SUBJECT);

    expect(found).not.toBeNull();
    expect(found!.runId).toBe("run-1");
    // Counted from the league rows, not from the run row's own lagging
    // counters, exactly as readCaptureProgress does everywhere else.
    expect(found!.progress.status).toBe("capturing");
    expect(found!.progress.leaguesDone).toBe(2);
    expect(found!.progress.leaguesFailed).toBe(1);
  });

  it("returns a run parked at computing, which is the case that used to lock a reader out", async () => {
    // THE BUG THIS EXISTS FOR. A capture finishes reading leagues and parks at
    // 'computing', waiting for a render to build the report. Every such render
    // used to call startManagerCapture, which claims a NEW run, which the
    // per-user budget refuses. The reader who waited out the whole capture
    // was answered "one lookup at a time" and got no report for an hour.
    const admin = makeFakeAdmin({
      managerPulseRun: () => freshRun({ status: "computing" }),
      managerPulseRunLeagues: () => runLeagueRows(["done"]),
      managerPulseLiveReports: noLiveReport,
    });

    const found = await findOpenRun(admin, SUBJECT);

    expect(found).not.toBeNull();
    expect(found!.progress.status).toBe("computing");
  });

  it("returns null when there is no open run, so the caller claims a fresh one", async () => {
    const admin = makeFakeAdmin({
      managerPulseRun: () => ({ data: null, error: null }),
      managerPulseRunLeagues: () => runLeagueRows([]),
    });

    expect(await findOpenRun(admin, SUBJECT)).toBeNull();
  });

  it("never throws on an unreadable run: no run is the honest answer", async () => {
    const admin = makeFakeAdmin({
      managerPulseRun: () => {
        throw new Error("connection reset");
      },
      managerPulseRunLeagues: () => runLeagueRows([]),
    });

    expect(await findOpenRun(admin, SUBJECT)).toBeNull();
  });

  /*
   * MPS-T046: a run whose linked jobs have all gone quiet is abandoned, not
   * open. `resumeMaxAgeMinutes` is gone from this check entirely; liveness is
   * judged from the jobs themselves.
   */
  it("returns null when every linked job is dead (processing but stale)", async () => {
    const admin = makeFakeAdmin({
      managerPulseRun: () => freshRun({ status: "capturing", leagues_total: 2 }),
      managerPulseRunLeagues: () => ({
        data: [
          { status: "queued", job_id: "job-1" },
          { status: "queued", job_id: "job-2" },
        ],
        error: null,
      }),
      leagueSyncJobs: () => ({
        data: [],
        error: null,
        // First head-count call: how many of the two linked jobs are still
        // pending/processing. Second head-count call: how many of those are
        // processing but stale. Both linked jobs are dead, so both counts
        // read the same: 2 alive-looking, 2 of them stale.
        count: 2,
      }),
    });

    expect(await findOpenRun(admin, SUBJECT)).toBeNull();
  });

  it("stays open when a linked job is still pending (not yet picked up)", async () => {
    const admin = makeFakeAdmin({
      managerPulseRun: () => freshRun({ status: "capturing", leagues_total: 1 }),
      managerPulseRunLeagues: () => ({
        data: [{ status: "queued", job_id: "job-1" }],
        error: null,
      }),
      // One alive (pending/processing), zero stale: a run with a job that
      // simply has not been picked up yet is not abandoned.
      leagueSyncJobs: (() => {
        let call = 0;
        return () => {
          call += 1;
          return { data: [], error: null, count: call === 1 ? 1 : 0 };
        };
      })(),
      managerPulseLiveReports: noLiveReport,
    });

    const found = await findOpenRun(admin, SUBJECT);
    expect(found).not.toBeNull();
  });
});
