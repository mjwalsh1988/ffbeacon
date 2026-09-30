import { beforeEach, describe, expect, it, vi } from "vitest";

const leagueLookup = vi.fn();
const pulseLeagueCore = vi.fn();
const pulseLeagueDerived = vi.fn();
const claimRateLimitSlot = vi.fn();

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => leagueLookup() }),
      }),
    }),
  }),
}));

vi.mock("@/lib/league-pulse", () => ({
  LEAGUE_PULSE_TTL_MS: 60 * 60 * 1000,
  pulseLeagueCore: (...args: unknown[]) => pulseLeagueCore(...args),
  pulseLeagueDerived: (...args: unknown[]) => pulseLeagueDerived(...args),
}));

vi.mock("@/lib/rate-limit-claim", () => ({
  claimRateLimitSlot: (...args: unknown[]) => claimRateLimitSlot(...args),
}));

import { POST } from "./route";

function call(id: string, headers: Record<string, string> = { "x-requested-with": "ff-beacon" }) {
  return POST(new Request(`https://ffbeacon.test/api/leagues/${id}/warm`, { method: "POST", headers }), {
    params: Promise.resolve({ league_id: id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  pulseLeagueCore.mockResolvedValue({ ok: true, cached: false, leagueRowId: "row-1" });
  claimRateLimitSlot.mockResolvedValue(true);
});

describe("POST /api/leagues/[id]/warm", () => {
  it("rejects a malformed id before claiming or syncing", async () => {
    const res = await call("bad id!");
    expect(res.status).toBe(400);
    expect(claimRateLimitSlot).not.toHaveBeenCalled();
    expect(pulseLeagueCore).not.toHaveBeenCalled();
  });

  it("rejects a cross-site request before claiming or syncing", async () => {
    const res = await call("123", {});
    expect(res.status).toBe(403);
    expect(claimRateLimitSlot).not.toHaveBeenCalled();
    expect(pulseLeagueCore).not.toHaveBeenCalled();
  });

  it("does not sync a never-stored league when the caller is over budget", async () => {
    leagueLookup.mockResolvedValue({ data: null, error: null });
    claimRateLimitSlot.mockResolvedValue(false);
    const res = await call("123");
    expect(res.status).toBe(429);
    expect(claimRateLimitSlot).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "league-warm-new" }),
    );
    expect(pulseLeagueCore).not.toHaveBeenCalled();
  });

  it("syncs a never-stored league when the caller is within budget", async () => {
    leagueLookup.mockResolvedValue({ data: null, error: null });
    const res = await call("123");
    expect(res.status).toBe(202);
    expect(pulseLeagueCore).toHaveBeenCalledTimes(1);
  });

  it("claims nothing for a fresh stored league", async () => {
    leagueLookup.mockResolvedValue({
      data: { last_pulsed_at: new Date().toISOString(), pulse_status: "complete" },
      error: null,
    });
    const res = await call("123");
    expect(res.status).toBe(202);
    expect(claimRateLimitSlot).not.toHaveBeenCalled();
  });

  it("claims the stale budget for a stored league past the cache window", async () => {
    leagueLookup.mockResolvedValue({
      data: {
        last_pulsed_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        pulse_status: "complete",
      },
      error: null,
    });
    await call("123");
    expect(claimRateLimitSlot).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "league-warm" }),
    );
  });
});
