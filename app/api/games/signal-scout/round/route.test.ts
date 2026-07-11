import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  createAdminClientMock,
  getUserMock,
  startRoundMock,
  findActiveRoundIdMock,
  loadSettingsMock,
  rpcMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getUserMock: vi.fn(),
  startRoundMock: vi.fn(),
  findActiveRoundIdMock: vi.fn(),
  loadSettingsMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: createAdminClientMock,
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("@/lib/signal-scout/round-engine", () => ({
  startRound: startRoundMock,
  findActiveRoundId: findActiveRoundIdMock,
}));

vi.mock("@/lib/signal-scout/settings", () => ({
  loadSignalScoutSettings: loadSettingsMock,
}));

import { POST } from "./route";
import { SCOUT_GUEST_COOKIE } from "@/lib/signal-scout/route-helpers";

const VALID_GUEST_ID = "11111111-1111-4111-8111-111111111111";

const ENABLED_SETTINGS = {
  game_enabled: true,
  guest_play_enabled: true,
  guest_daily_round_limit: 2,
};

function req(headers: Record<string, string> = { "x-requested-with": "ff-beacon" }): Request {
  return new Request("http://test/api/games/signal-scout/round", { method: "POST", headers });
}

/** Default RPC responses, overridable per RPC name for a single test. */
function rpcImpl(overrides: Partial<Record<string, { data: unknown; error: unknown }>> = {}) {
  return (name: string) => {
    if (overrides[name]) return Promise.resolve(overrides[name]!);
    if (name === "try_claim_signal_scout_action") return Promise.resolve({ data: true, error: null });
    if (name === "try_start_signal_scout_guest_round") return Promise.resolve({ data: true, error: null });
    return Promise.resolve({ data: null, error: null });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({ rpc: rpcMock });
  rpcMock.mockImplementation(rpcImpl());
  getUserMock.mockResolvedValue({ data: { user: null } });
  loadSettingsMock.mockResolvedValue(ENABLED_SETTINGS);
  findActiveRoundIdMock.mockResolvedValue(null);
  startRoundMock.mockResolvedValue({ ok: true, round: { roundId: "round-1", score: 1000 } });
});

describe("POST /api/games/signal-scout/round", () => {
  it("rejects a missing x-requested-with header with 403 and does nothing else", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(loadSettingsMock).not.toHaveBeenCalled();
    expect(findActiveRoundIdMock).not.toHaveBeenCalled();
  });

  it("returns 503 game_disabled when the game is disabled", async () => {
    loadSettingsMock.mockResolvedValue({ ...ENABLED_SETTINGS, game_enabled: false });
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "game_disabled" });
    expect(findActiveRoundIdMock).not.toHaveBeenCalled();
  });

  it("returns 403 guest_play_disabled for a guest when guest play is off", async () => {
    loadSettingsMock.mockResolvedValue({ ...ENABLED_SETTINGS, guest_play_enabled: false });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "guest_play_disabled" });
  });

  it("returns 409 active_round_exists on resume without spending any claim", async () => {
    findActiveRoundIdMock.mockResolvedValue("round-99");
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "active_round_exists", roundId: "round-99" });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(startRoundMock).not.toHaveBeenCalled();
  });

  it("returns 429 rate_limited when the round_start claim is denied", async () => {
    rpcMock.mockImplementation(rpcImpl({ try_claim_signal_scout_action: { data: false, error: null } }));
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(startRoundMock).not.toHaveBeenCalled();
  });

  it("returns 429 guest_limit_reached, with a non-empty p_ip_hash even with no IP headers", async () => {
    rpcMock.mockImplementation(rpcImpl({ try_start_signal_scout_guest_round: { data: false, error: null } }));
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "guest_limit_reached" });

    const guestCapCall = rpcMock.mock.calls.find(([name]) => name === "try_start_signal_scout_guest_round");
    expect(guestCapCall).toBeTruthy();
    const args = guestCapCall![1] as Record<string, unknown>;
    expect(typeof args.p_ip_hash).toBe("string");
    expect((args.p_ip_hash as string).length).toBeGreaterThan(0);
    expect(startRoundMock).not.toHaveBeenCalled();
  });

  it("never calls the guest-cap RPC for a logged-in user", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const res = await POST(req());
    expect(res.status).toBe(200);
    const guestCapCall = rpcMock.mock.calls.find(([name]) => name === "try_start_signal_scout_guest_round");
    expect(guestCapCall).toBeUndefined();
    expect(startRoundMock).toHaveBeenCalledWith(expect.anything(), { kind: "user", userId: "user-1" });
  });

  it("returns 200 with the round DTO and sets the guest cookie for a brand-new guest", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ round: { roundId: "round-1", score: 1000 } });

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(SCOUT_GUEST_COOKIE);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain(`Max-Age=${60 * 60 * 24 * 365}`);
  });

  it("sets no cookie for a logged-in user", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not re-set the cookie when the guest already has a valid one", async () => {
    const res = await POST(
      req({ "x-requested-with": "ff-beacon", cookie: `${SCOUT_GUEST_COOKIE}=${VALID_GUEST_ID}` }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(startRoundMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "guest", guestId: VALID_GUEST_ID }),
    );
  });

  it("sets the guest cookie even on an early error response for a new guest", async () => {
    loadSettingsMock.mockResolvedValue({ ...ENABLED_SETTINGS, game_enabled: false });
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toContain(SCOUT_GUEST_COOKIE);
  });

  it("maps an unexpected engine throw to 500 server_error with no DB detail leaked", async () => {
    startRoundMock.mockRejectedValue(new Error("relation signal_scout_rounds violates secret constraint xyz"));
    const res = await POST(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "server_error" });
    expect(JSON.stringify(body)).not.toContain("secret constraint");
  });

  it("maps a startRound active_round_exists race to 409 with the winning roundId", async () => {
    startRoundMock.mockResolvedValue({ ok: false, code: "active_round_exists", existingRoundId: "round-race" });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "active_round_exists", roundId: "round-race" });
  });

  it("maps a pool_empty startRound result to 503", async () => {
    startRoundMock.mockResolvedValue({ ok: false, code: "pool_empty" });
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "pool_empty" });
  });
});
