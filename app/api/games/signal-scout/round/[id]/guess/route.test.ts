import { describe, it, expect, vi, beforeEach } from "vitest";

const { createAdminClientMock, getUserMock, submitGuessMock, rpcMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getUserMock: vi.fn(),
  submitGuessMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: createAdminClientMock,
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("@/lib/signal-scout/round-engine", () => ({
  submitGuess: submitGuessMock,
}));

import { POST } from "./route";

const VALID_ROUND_ID = "22222222-2222-4222-8222-222222222222";
const VALID_GUESS_ID = "33333333-3333-4333-8333-333333333333";

const ACTIVE_DTO = {
  roundId: VALID_ROUND_ID,
  score: 900,
  wrongGuesses: 1,
  maxWrongGuesses: 3,
  burned: false,
  revealedClues: [],
  lockedCounts: { weak: 0, clear: 0, ping: 0, scan: 0 },
  purchasesRemaining: { weak: 0, clear: 0, ping: 0, scan: 0 },
  tierCosts: { weak: 100, clear: 200, ping: 350, scan: 500 },
  badReads: [],
  guest: false,
};

const COMPLETED_DTO = {
  ...ACTIVE_DTO,
  status: "won",
  scoreAwarded: 900,
  target: { playerId: "player-1", name: "Test Player", position: "WR", team: "PHI", sleeperId: "1234" },
  allClues: [],
};

function req(
  body: unknown = { guessedPlayerId: VALID_GUESS_ID },
  headers: Record<string, string> = { "x-requested-with": "ff-beacon" },
): Request {
  return new Request(`http://test/api/games/signal-scout/round/${VALID_ROUND_ID}/guess`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function ctx(id: string = VALID_ROUND_ID) {
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
  getUserMock.mockResolvedValue({ data: { user: null } });
  submitGuessMock.mockResolvedValue({ ok: true, round: ACTIVE_DTO });
});

describe("POST /api/games/signal-scout/round/[id]/guess", () => {
  it("rejects a missing x-requested-with header with 403 and does nothing else", async () => {
    const res = await POST(req({ guessedPlayerId: VALID_GUESS_ID }, {}), ctx());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(submitGuessMock).not.toHaveBeenCalled();
  });

  it("returns 404 not_found for a malformed round id", async () => {
    const res = await POST(req(), ctx("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(submitGuessMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for malformed JSON", async () => {
    const malformed = new Request(`http://test/api/games/signal-scout/round/${VALID_ROUND_ID}/guess`, {
      method: "POST",
      headers: { "x-requested-with": "ff-beacon", "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(malformed, ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(submitGuessMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a non-uuid guessedPlayerId", async () => {
    const res = await POST(req({ guessedPlayerId: "not-a-uuid" }), ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(submitGuessMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request when guessedPlayerId is missing", async () => {
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(submitGuessMock).not.toHaveBeenCalled();
  });

  it("returns 429 rate_limited when the guess claim is denied", async () => {
    rpcMock.mockImplementation(rpcImpl({ try_claim_signal_scout_action: { data: false, error: null } }));
    const res = await POST(req(), ctx());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(submitGuessMock).not.toHaveBeenCalled();
  });

  it("returns 409 guess_duplicate when the engine rejects a repeat guess", async () => {
    submitGuessMock.mockResolvedValue({ ok: false, code: "guess_duplicate" });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "guess_duplicate" });
  });

  it("returns 400 guess_out_of_pool when the engine rejects an ineligible player", async () => {
    submitGuessMock.mockResolvedValue({ ok: false, code: "guess_out_of_pool" });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "guess_out_of_pool" });
  });

  it("returns 404 not_found when the engine cannot find an owned round", async () => {
    submitGuessMock.mockResolvedValue({ ok: false, code: "not_found" });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 409 round_not_active when the round already completed", async () => {
    submitGuessMock.mockResolvedValue({ ok: false, code: "round_not_active" });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "round_not_active" });
  });

  it("returns 200 with the active DTO passthrough for a survivable wrong guess", async () => {
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ round: ACTIVE_DTO });
    expect(submitGuessMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "guest" }),
      VALID_ROUND_ID,
      VALID_GUESS_ID,
    );
  });

  it("returns 200 with the completed DTO passthrough on completion, including the full reveal", async () => {
    submitGuessMock.mockResolvedValue({ ok: true, round: COMPLETED_DTO });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ round: COMPLETED_DTO });
    expect(body.round.target).toBeDefined();
    expect(body.round.status).toBe("won");
  });

  it("uses the logged-in user's identity when a session exists", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(submitGuessMock).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "user", userId: "user-1" },
      VALID_ROUND_ID,
      VALID_GUESS_ID,
    );
  });

  it("maps an unexpected engine throw to 500 server_error with no DB detail leaked", async () => {
    submitGuessMock.mockRejectedValue(new Error("relation signal_scout_rounds violates secret constraint xyz"));
    const res = await POST(req(), ctx());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "server_error" });
    expect(JSON.stringify(body)).not.toContain("secret constraint");
  });
});
