/**
 * Coverage for the two-to-eight-candidate generalization of loadLeagueMode
 * (SEO-T927): the id-list validation, the rate-limit claim ordering (validate
 * first, claim second), and the cache key.
 *
 * calculateLeagueImpact is mocked outright; this file is about the guard in
 * front of it, not the computation, which lib/breakdown/league-impact.test.ts
 * already covers. next/cache's unstable_cache is mocked to a pass-through
 * (matching lib/positional-war/load.test.ts): outside a real Next.js request
 * context it does not behave like a cache anyway.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheState = vi.hoisted(() => ({ keys: [] as string[][] }));

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown, keyParts: string[]) =>
    async (...args: unknown[]) => {
      cacheState.keys.push(keyParts);
      return fn(...args);
    },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/rate-limit-actor", () => ({
  resolveRateLimitActorKey: vi.fn().mockResolvedValue("user:test-actor"),
}));

vi.mock("@/lib/breakdown/league-impact", () => ({
  calculateLeagueImpact: vi.fn(),
}));

type FakeAdminOptions = {
  rpcResult: boolean | null;
  league: { id: string } | null;
};

function makeFakeAdmin(opts: FakeAdminOptions) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: opts.rpcResult, error: null }),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: opts.league, error: null }),
        }),
      }),
    })),
  };
}

let activeAdmin: ReturnType<typeof makeFakeAdmin>;
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => activeAdmin,
}));

const { loadLeagueMode } = await import("./league-mode");
const { calculateLeagueImpact } = await import("./league-impact");

const OK_REPORT = {
  league: {
    sleeperLeagueId: "sleeper-1",
    name: "Test League",
    season: 2026,
    teams: 2,
    currentWeek: 5,
    lastRegularWeek: 6,
    scoringDescription: "PPR",
    usedLeagueScoring: true,
  },
  team: { rosterId: 1, name: "My Team", record: "5-3" },
  impacts: [],
  notices: [] as string[],
};

beforeEach(() => {
  cacheState.keys = [];
  activeAdmin = makeFakeAdmin({ rpcResult: true, league: { id: "league-row-1" } });
  vi.mocked(calculateLeagueImpact).mockReset();
  vi.mocked(calculateLeagueImpact).mockResolvedValue({ ok: true, report: OK_REPORT as never });
});

describe("loadLeagueMode: validation, before anything is claimed", () => {
  it("refuses a malformed league id without claiming a rate-limit slot", async () => {
    const result = await loadLeagueMode({
      sleeperLeagueId: "not a valid id!",
      rosterId: 1,
      sleeperIds: ["c1", "c2"],
    });
    expect(result.report).toBeNull();
    expect(result.notice).toBe("That league link does not look right.");
    expect(activeAdmin.rpc).not.toHaveBeenCalled();
    expect(calculateLeagueImpact).not.toHaveBeenCalled();
  });

  it("refuses a non-positive roster id", async () => {
    const result = await loadLeagueMode({
      sleeperLeagueId: "sleeper-1",
      rosterId: 0,
      sleeperIds: ["c1", "c2"],
    });
    expect(result.notice).toBe("That team link does not look right.");
    expect(activeAdmin.rpc).not.toHaveBeenCalled();
  });

  it("refuses fewer than two candidate ids", async () => {
    const result = await loadLeagueMode({
      sleeperLeagueId: "sleeper-1",
      rosterId: 1,
      sleeperIds: ["c1"],
    });
    expect(result.notice).toBe("That comparison link does not look right.");
    expect(activeAdmin.rpc).not.toHaveBeenCalled();
  });

  it("refuses more than eight candidate ids", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `c${i}`);
    const result = await loadLeagueMode({
      sleeperLeagueId: "sleeper-1",
      rosterId: 1,
      sleeperIds: nine,
    });
    expect(result.notice).toBe("That comparison link does not look right.");
    expect(activeAdmin.rpc).not.toHaveBeenCalled();
  });

  it("keeps the original 'neither' wording when exactly two ids are unusable", async () => {
    const result = await loadLeagueMode({
      sleeperLeagueId: "sleeper-1",
      rosterId: 1,
      sleeperIds: [null, "not valid!!"],
    });
    expect(result.notice).toBe(
      "Neither of these players maps to a Sleeper id, so we cannot place them on a roster.",
    );
    expect(activeAdmin.rpc).not.toHaveBeenCalled();
  });

  it("uses the generalized 'none' wording when more than two ids are unusable", async () => {
    const result = await loadLeagueMode({
      sleeperLeagueId: "sleeper-1",
      rosterId: 1,
      sleeperIds: [null, "not valid!!", null],
    });
    expect(result.notice).toBe(
      "None of these players maps to a Sleeper id, so we cannot place them on a roster.",
    );
  });

  it("keeps a board of two to eight with at least one usable id, dropping only the invalid ones", async () => {
    const result = await loadLeagueMode({
      sleeperLeagueId: "sleeper-1",
      rosterId: 1,
      sleeperIds: ["c1", "not valid!!", "c3", null],
    });
    expect(result.report).not.toBeNull();
    expect(vi.mocked(calculateLeagueImpact).mock.calls[0]![1]).toEqual({
      leagueRowId: "league-row-1",
      sleeperRosterId: 1,
      candidateSleeperIds: ["c1", null, "c3", null],
    });
  });
});

describe("loadLeagueMode: league lookup and the rate limit, in order", () => {
  it("reports an unsynced league without claiming a rate-limit slot", async () => {
    activeAdmin = makeFakeAdmin({ rpcResult: true, league: null });
    const result = await loadLeagueMode({
      sleeperLeagueId: "sleeper-1",
      rosterId: 1,
      sleeperIds: ["c1", "c2", "c3"],
    });
    expect(result.notice).toBe(
      "That league did not finish syncing. Pick it again from the league list and it will fill in.",
    );
    expect(activeAdmin.rpc).not.toHaveBeenCalled();
    expect(calculateLeagueImpact).not.toHaveBeenCalled();
  });

  it("reports a throttle when the rate limit is not claimed, after the league lookup", async () => {
    activeAdmin = makeFakeAdmin({ rpcResult: false, league: { id: "league-row-1" } });
    const result = await loadLeagueMode({
      sleeperLeagueId: "sleeper-1",
      rosterId: 1,
      sleeperIds: ["c1", "c2", "c3"],
    });
    expect(result.notice).toMatch(/heavy work/);
    expect(activeAdmin.rpc).toHaveBeenCalledTimes(1);
    expect(calculateLeagueImpact).not.toHaveBeenCalled();
  });
});

describe("loadLeagueMode: the happy path scales the cache key to N", () => {
  it("keys the cache on every candidate id, in board order, for a board of three", async () => {
    const result = await loadLeagueMode({
      sleeperLeagueId: "sleeper-1",
      rosterId: 7,
      sleeperIds: ["c1", "c2", "c3"],
    });
    expect(result.notice).toBeNull();
    expect(result.report).toEqual(OK_REPORT);
    expect(calculateLeagueImpact).toHaveBeenCalledTimes(1);
    expect(vi.mocked(calculateLeagueImpact).mock.calls[0]![1]).toEqual({
      leagueRowId: "league-row-1",
      sleeperRosterId: 7,
      candidateSleeperIds: ["c1", "c2", "c3"],
    });
    expect(cacheState.keys[0]![1]).toBe("league-row-1:7:c1:c2:c3");
  });

  it("keys the cache on every candidate id for a board of eight, including unmatched slots", async () => {
    const eight = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", null];
    await loadLeagueMode({
      sleeperLeagueId: "sleeper-1",
      rosterId: 1,
      sleeperIds: eight,
    });
    expect(cacheState.keys[0]![1]).toBe("league-row-1:1:c1:c2:c3:c4:c5:c6:c7:-");
  });

  it("returns the outcome's error as a notice without throwing when the computation itself refuses", async () => {
    vi.mocked(calculateLeagueImpact).mockResolvedValue({
      ok: false,
      error: "We do not have this league synced yet.",
    });
    const result = await loadLeagueMode({
      sleeperLeagueId: "sleeper-1",
      rosterId: 1,
      sleeperIds: ["c1", "c2"],
    });
    expect(result.report).toBeNull();
    expect(result.notice).toBe("We do not have this league synced yet.");
  });

  it("degrades to a generic notice, never throwing, when the computation rejects", async () => {
    vi.mocked(calculateLeagueImpact).mockRejectedValue(new Error("boom"));
    const result = await loadLeagueMode({
      sleeperLeagueId: "sleeper-1",
      rosterId: 1,
      sleeperIds: ["c1", "c2"],
    });
    expect(result.report).toBeNull();
    expect(result.notice).toBe(
      "Something went wrong reading that league. The general comparison is below.",
    );
  });
});
