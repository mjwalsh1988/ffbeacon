import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

vi.mock("@/lib/sleeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sleeper")>();
  return {
    ...actual,
    getSleeperUser: vi.fn(),
    getSleeperLeagues: vi.fn(),
    currentNflSeason: vi.fn(() => "2026"),
  };
});

vi.mock("./rate-limit", () => ({
  claimManagerLookupSlot: vi.fn(),
}));

import { getSleeperLeagues, getSleeperUser } from "@/lib/sleeper";
import { claimManagerLookupSlot } from "./rate-limit";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import { readCaptureProgress, startManagerCapture } from "./capture";
import type { ManagerPulseSettings } from "./types";

const mockGetSleeperUser = vi.mocked(getSleeperUser);
const mockGetSleeperLeagues = vi.mocked(getSleeperLeagues);
const mockClaimLookup = vi.mocked(claimManagerLookupSlot);

/* -------------------------------------------------------------------------- */
/* A minimal fake PostgREST + RPC client                                      */
/* -------------------------------------------------------------------------- */

type FakeResponse = { data: unknown; error: unknown };
type RpcCall = { name: string; args: unknown };

type FakeAdminHandlers = {
  leagues?: () => FakeResponse;
  managerPulseRun?: () => FakeResponse;
  managerPulseRunLeagues?: () => FakeResponse;
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
      leagues_total: 1,
      leagues_done: 1,
      leagues_failed: 0,
      section_status: {},
      detail: null,
      ...overrides,
    },
    error: null,
  };
}

function runLeagueRows(statuses: string[]) {
  return { data: statuses.map((status) => ({ status })), error: null };
}

beforeEach(() => {
  mockGetSleeperUser.mockReset();
  mockGetSleeperLeagues.mockReset();
  mockClaimLookup.mockReset();
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

  it("returns throttled on a cooldown reply from try_claim_manager_pulse", async () => {
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
            data: { claimed: false, reason: "cooldown", retry_after_seconds: 900 },
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

    expect(result).toEqual({ status: "throttled", retryAfterSeconds: 900 });
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
        data: [{ sleeper_league_id: "L1", last_pulsed_at: NOW_ISO }],
        error: null,
      }),
      managerPulseRun: () => freshRun({ status: "computing", leagues_total: 1, leagues_done: 1 }),
      managerPulseRunLeagues: () => runLeagueRows(["fresh"]),
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

    // The enqueue call told the RPC this league needed no capture.
    const enqueueCall = admin.rpcCalls.find((c) => c.name === "enqueue_manager_pulse_capture");
    const payload = enqueueCall?.args as { p_leagues: Array<{ needs_capture: boolean }> };
    expect(payload.p_leagues[0].needs_capture).toBe(false);
  });

  it("decides freshness from the TTL setting, not a hardcoded number", async () => {
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

    // Last pulsed 90 minutes ago.
    const ninetyMinutesAgo = new Date(Date.parse(NOW_ISO) - 90 * 60_000).toISOString();

    async function run(settings: ManagerPulseSettings): Promise<boolean> {
      const admin = makeFakeAdmin({
        leagues: () => ({
          data: [{ sleeper_league_id: "L1", last_pulsed_at: ninetyMinutesAgo }],
          error: null,
        }),
        managerPulseRun: () => freshRun(),
        managerPulseRunLeagues: () => runLeagueRows(["fresh"]),
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

    // 60-minute TTL: a league last pulsed 90 minutes ago is stale.
    const staleAt60 = await run({
      ...DEFAULT_MANAGER_PULSE_SETTINGS,
      capture: { ...DEFAULT_MANAGER_PULSE_SETTINGS.capture, captureTtlMinutes: 60 },
    });
    expect(staleAt60).toBe(true);

    // 120-minute TTL: the same 90-minute-old league is now fresh.
    const freshAt120 = await run({
      ...DEFAULT_MANAGER_PULSE_SETTINGS,
      capture: { ...DEFAULT_MANAGER_PULSE_SETTINGS.capture, captureTtlMinutes: 120 },
    });
    expect(freshAt120).toBe(false);
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
    });

    const progress = await readCaptureProgress(admin, "run-1");

    expect(progress).not.toBeNull();
    expect(progress?.leaguesDone).toBe(2);
    expect(progress?.leaguesFailed).toBe(1);
  });

  it("falls back to the run row's own counters when the grouped read fails", async () => {
    const admin = makeFakeAdmin({
      managerPulseRun: () =>
        freshRun({ status: "capturing", leagues_total: 3, leagues_done: 1, leagues_failed: 0 }),
      managerPulseRunLeagues: () => ({ data: null, error: { message: "boom" } }),
    });

    const progress = await readCaptureProgress(admin, "run-1");

    expect(progress?.leaguesDone).toBe(1);
    expect(progress?.leaguesFailed).toBe(0);
  });

  it("returns null, never throws, when the run does not exist", async () => {
    const admin = makeFakeAdmin({
      managerPulseRun: () => ({ data: null, error: null }),
      managerPulseRunLeagues: () => runLeagueRows([]),
    });

    const progress = await readCaptureProgress(admin, "missing-run");
    expect(progress).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Admin throttle bypass                                                      */
/* -------------------------------------------------------------------------- */

/*
 * The bypass exists so the person who owns the tool can actually exercise it:
 * a one-hour cooldown makes testing a report impossible. It is deliberately
 * narrow, and these tests are what keep it narrow. It skips the lookup slot and
 * sets the run cooldown to zero, and it changes NOTHING else. In particular it
 * must not widen maxLeaguesPerRun, because that is a cost control rather than a
 * convenience, and an admin who could queue an unbounded run would be able to
 * point the whole site's sync drain at one lookup.
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


  it("claims no lookup slot and passes a zero cooldown", async () => {
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
    expect((claim!.args as { p_cooldown_seconds: number }).p_cooldown_seconds).toBe(0);
  });

  it("passes the real cooldown when the bypass is off", async () => {
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
    expect((claim!.args as { p_cooldown_seconds: number }).p_cooldown_seconds).toBe(
      DEFAULT_MANAGER_PULSE_SETTINGS.capture.runCooldownSeconds,
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
