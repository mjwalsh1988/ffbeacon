import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/league-pulse", () => ({
  isLeaguePulseFresh: vi.fn(() => false),
  pulseLeagueCore: vi.fn(),
  pulseLeagueDerived: vi.fn(async () => ({ transactions: 0 })),
}));

import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { refreshStaleLeagues, syncLeagueOnDemand } from "./league-on-demand-sync";

/** Stored row for the freshness check, a claim that always succeeds, and a release. */
function fakeAdmin(stored: Record<string, unknown> | null, rows: Array<Record<string, unknown>> = []) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: stored, error: null }) }),
        in: async () => ({ data: rows, error: null }),
      }),
    }),
    rpc: async (name: string) =>
      name === "try_claim_league_sync" ? { data: { claimed: true }, error: null } : { data: null, error: null },
  } as never;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("syncLeagueOnDemand", () => {
  it("answers a frozen league from storage without syncing", async () => {
    const outcome = await syncLeagueOnDemand(fakeAdmin({ frozen_at: "2026-11-13T00:00:00Z" }), "L1", "actor");
    expect(outcome).toEqual({ ok: true, cached: true });
    expect(pulseLeagueCore).not.toHaveBeenCalled();
  });

  it("calls a Sleeper timeout a temporary failure, not a missing league", async () => {
    vi.mocked(pulseLeagueCore).mockResolvedValue({
      ok: false,
      error: "Sleeper league fetch failed",
      sleeperLeagueId: "L1",
      reason: "sleeper_failed",
    });
    const outcome = await syncLeagueOnDemand(fakeAdmin(null), "L1", "actor");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("failed");
    expect(outcome.retryInSeconds).toBeGreaterThan(0);
    expect(outcome.error).not.toMatch(/could not find/i);
  });

  it("still reports a real not-found as not found", async () => {
    vi.mocked(pulseLeagueCore).mockResolvedValue({
      ok: false,
      error: "Sleeper league not found",
      sleeperLeagueId: "L1",
      reason: "not_found",
    });
    const outcome = await syncLeagueOnDemand(fakeAdmin(null), "L1", "actor");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("not_found");
  });

  it("honors syncFailed: no derived pass, and a temporary failure", async () => {
    vi.mocked(pulseLeagueCore).mockResolvedValue({
      ok: true,
      leagueRowId: "row",
      sleeperLeagueId: "L1",
      season: 2026,
      cached: true,
      counts: { rosters: 0, users: 0 },
      league: null,
      syncFailed: "Sleeper did not answer for: rosters",
    });
    const outcome = await syncLeagueOnDemand(fakeAdmin(null), "L1", "actor");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("failed");
    expect(pulseLeagueDerived).not.toHaveBeenCalled();
  });
});

describe("refreshStaleLeagues", () => {
  it("never refreshes a frozen league", async () => {
    const admin = fakeAdmin(null, [
      { sleeper_league_id: "L1", last_pulsed_at: null, pulse_status: "complete", frozen_at: "2026-11-13T00:00:00Z" },
    ]);
    const result = await refreshStaleLeagues(admin, ["L1"], { derived: false, max: 5, concurrency: 1 });
    expect(result).toEqual({ refreshed: 0, failed: 0 });
    expect(pulseLeagueCore).not.toHaveBeenCalled();
  });
});
