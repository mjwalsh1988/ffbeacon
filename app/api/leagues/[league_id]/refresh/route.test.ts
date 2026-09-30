import { beforeEach, describe, expect, it, vi } from "vitest";

const leagueLookup = vi.fn();
const rpc = vi.fn();
const pulseLeague = vi.fn();
const claimRateLimitSlot = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => leagueLookup() }),
      }),
    }),
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));

vi.mock("@/lib/league-pulse", () => ({
  pulseLeague: (...args: unknown[]) => pulseLeague(...args),
}));

vi.mock("@/lib/rate-limit-claim", () => ({
  claimRateLimitSlot: (...args: unknown[]) => claimRateLimitSlot(...args),
}));

import { POST } from "./route";

function call(id: string, headers: Record<string, string> = { "x-requested-with": "ff-beacon" }) {
  return POST(new Request(`https://ffbeacon.test/api/leagues/${id}/refresh`, { method: "POST", headers }), {
    params: Promise.resolve({ league_id: id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  leagueLookup.mockResolvedValue({ data: { id: "row-1" }, error: null });
  rpc.mockResolvedValue({ data: true, error: null });
  pulseLeague.mockResolvedValue({ ok: true, cached: false, counts: {} });
  claimRateLimitSlot.mockResolvedValue(true);
});

describe("POST /api/leagues/[id]/refresh", () => {
  it("claims nothing for an unknown league", async () => {
    leagueLookup.mockResolvedValue({ data: null, error: null });
    const res = await call("123");
    expect(res.status).toBe(404);
    expect(claimRateLimitSlot).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a caller over their budget before touching the league cooldown", async () => {
    claimRateLimitSlot.mockResolvedValue(false);
    const res = await call("123");
    expect(res.status).toBe(429);
    expect(claimRateLimitSlot).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "league-refresh" }),
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(pulseLeague).not.toHaveBeenCalled();
  });

  it("still honours the per-league cooldown for a caller within budget", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await call("123");
    expect(res.status).toBe(429);
    expect(pulseLeague).not.toHaveBeenCalled();
  });

  it("forces a pulse when both limits pass, with no sign-in required", async () => {
    const res = await call("123");
    expect(res.status).toBe(200);
    expect(pulseLeague).toHaveBeenCalledWith(expect.anything(), "123", { force: true });
  });
});
