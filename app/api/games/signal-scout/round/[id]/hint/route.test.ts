import { describe, it, expect, vi, beforeEach } from "vitest";

const { createAdminClientMock, getUserMock, purchaseHintMock, rpcMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getUserMock: vi.fn(),
  purchaseHintMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: createAdminClientMock,
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("@/lib/signal-scout/round-engine", () => ({
  purchaseHint: purchaseHintMock,
}));

import { POST } from "./route";

const VALID_ROUND_ID = "22222222-2222-4222-8222-222222222222";

const SUCCESS_RESULT = {
  ok: true as const,
  clue: { clueKey: "college", tier: "clear", label: "College", displayValue: "LSU", revealOrder: 4 },
  scoreAvailable: 800,
  burned: false,
  hintsUsed: 1,
  tierPurchasesRemaining: { weak: 4, clear: 2, ping: 2, scan: 1 },
  lockedCounts: { weak: 3, clear: 1, ping: 2, scan: 1 },
};

function req(
  body: unknown | string,
  headers: Record<string, string> = { "x-requested-with": "ff-beacon", "content-type": "application/json" },
): Request {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`http://test/api/games/signal-scout/round/${VALID_ROUND_ID}/hint`, {
    method: "POST",
    headers,
    body: rawBody,
  });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Default RPC responses, overridable per RPC name for a single test. */
function rpcImpl(overrides: Partial<Record<string, { data: unknown; error: unknown }>> = {}) {
  return (name: string) => {
    if (overrides[name]) return Promise.resolve(overrides[name]!);
    if (name === "try_claim_signal_scout_action") return Promise.resolve({ data: true, error: null });
    return Promise.resolve({ data: null, error: null });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({ rpc: rpcMock });
  rpcMock.mockImplementation(rpcImpl());
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  purchaseHintMock.mockResolvedValue(SUCCESS_RESULT);
});

describe("POST /api/games/signal-scout/round/[id]/hint", () => {
  it("rejects a missing x-requested-with header with 403 and does nothing else", async () => {
    const res = await POST(req({ tier: "clear" }, {}), paramsFor(VALID_ROUND_ID));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(purchaseHintMock).not.toHaveBeenCalled();
  });

  it("returns 404 not_found for a malformed round id, with no id-shape oracle", async () => {
    const res = await POST(req({ tier: "clear" }), paramsFor("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(purchaseHintMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a malformed JSON body", async () => {
    const res = await POST(req("{not json"), paramsFor(VALID_ROUND_ID));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(purchaseHintMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for an out-of-enum tier and never calls purchaseHint", async () => {
    const res = await POST(req({ tier: "ultra" }), paramsFor(VALID_ROUND_ID));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(purchaseHintMock).not.toHaveBeenCalled();
  });

  it("defaults a missing confirmBurn to false", async () => {
    const res = await POST(req({ tier: "weak" }), paramsFor(VALID_ROUND_ID));
    expect(res.status).toBe(200);
    expect(purchaseHintMock).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "user", userId: "user-1" },
      VALID_ROUND_ID,
      "weak",
      false,
    );
  });

  it("returns 429 rate_limited when the hint claim is denied, without calling purchaseHint", async () => {
    rpcMock.mockImplementation(rpcImpl({ try_claim_signal_scout_action: { data: false, error: null } }));
    const res = await POST(req({ tier: "clear" }), paramsFor(VALID_ROUND_ID));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(purchaseHintMock).not.toHaveBeenCalled();
  });

  it("claims the rate limit before calling purchaseHint (order matters)", async () => {
    const calls: string[] = [];
    rpcMock.mockImplementation((name: string) => {
      calls.push("claim");
      return Promise.resolve({ data: true, error: null });
    });
    purchaseHintMock.mockImplementation(async () => {
      calls.push("purchaseHint");
      return SUCCESS_RESULT;
    });
    await POST(req({ tier: "clear" }), paramsFor(VALID_ROUND_ID));
    expect(calls).toEqual(["claim", "purchaseHint"]);
  });

  it("passes through burn_confirmation_required as 409", async () => {
    purchaseHintMock.mockResolvedValue({ ok: false, code: "burn_confirmation_required" });
    const res = await POST(req({ tier: "scan" }), paramsFor(VALID_ROUND_ID));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "burn_confirmation_required" });
  });

  it("passes through signal_burned as 409", async () => {
    purchaseHintMock.mockResolvedValue({ ok: false, code: "signal_burned" });
    const res = await POST(req({ tier: "weak" }), paramsFor(VALID_ROUND_ID));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "signal_burned" });
  });

  it("passes through tier_limit_reached as 409", async () => {
    purchaseHintMock.mockResolvedValue({ ok: false, code: "tier_limit_reached" });
    const res = await POST(req({ tier: "ping" }), paramsFor(VALID_ROUND_ID));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "tier_limit_reached" });
  });

  it("returns 200 with the full success payload passed through from the engine", async () => {
    const res = await POST(req({ tier: "clear", confirmBurn: true }), paramsFor(VALID_ROUND_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      clue: SUCCESS_RESULT.clue,
      scoreAvailable: SUCCESS_RESULT.scoreAvailable,
      burned: SUCCESS_RESULT.burned,
      hintsUsed: SUCCESS_RESULT.hintsUsed,
      tierPurchasesRemaining: SUCCESS_RESULT.tierPurchasesRemaining,
      lockedCounts: SUCCESS_RESULT.lockedCounts,
    });
    expect(purchaseHintMock).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "user", userId: "user-1" },
      VALID_ROUND_ID,
      "clear",
      true,
    );
  });

  it("maps an unexpected engine throw to 500 server_error with no DB detail leaked", async () => {
    purchaseHintMock.mockRejectedValue(new Error("relation signal_scout_round_clues violates secret constraint xyz"));
    const res = await POST(req({ tier: "weak" }), paramsFor(VALID_ROUND_ID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "server_error" });
    expect(JSON.stringify(body)).not.toContain("secret constraint");
  });
});
