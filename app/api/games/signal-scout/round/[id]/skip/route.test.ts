import { describe, it, expect, vi, beforeEach } from "vitest";

const { createAdminClientMock, getUserMock, skipRoundMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getUserMock: vi.fn(),
  skipRoundMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: createAdminClientMock,
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("@/lib/signal-scout/round-engine", () => ({
  skipRound: skipRoundMock,
}));

import { POST } from "./route";

const VALID_ROUND_ID = "11111111-1111-4111-8111-111111111111";

function req(
  id: string,
  headers: Record<string, string> = { "x-requested-with": "ff-beacon" },
): Request {
  return new Request(`http://test/api/games/signal-scout/round/${id}/skip`, {
    method: "POST",
    headers,
  });
}

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const COMPLETED_ROUND = {
  roundId: VALID_ROUND_ID,
  status: "skipped",
  scoreAwarded: 0,
  target: { playerId: "player-1", name: "Test Player", position: "WR", team: "KC", sleeperId: "123" },
  allClues: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({});
  getUserMock.mockResolvedValue({ data: { user: null } });
  skipRoundMock.mockResolvedValue({ ok: true, round: COMPLETED_ROUND });
});

describe("POST /api/games/signal-scout/round/[id]/skip", () => {
  it("rejects a missing x-requested-with header with 403 and does nothing else", async () => {
    const res = await POST(req(VALID_ROUND_ID, {}), params(VALID_ROUND_ID));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(skipRoundMock).not.toHaveBeenCalled();
  });

  it("returns 404 not_found for a malformed id without calling skipRound", async () => {
    const res = await POST(req("not-a-uuid"), params("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(skipRoundMock).not.toHaveBeenCalled();
  });

  it("returns 404 not_found for an unowned or unknown round", async () => {
    skipRoundMock.mockResolvedValue({ ok: false, code: "not_found" });
    const res = await POST(req(VALID_ROUND_ID), params(VALID_ROUND_ID));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 409 round_not_active on a second skip of the same round", async () => {
    skipRoundMock.mockResolvedValue({ ok: false, code: "round_not_active" });
    const res = await POST(req(VALID_ROUND_ID), params(VALID_ROUND_ID));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "round_not_active" });
  });

  it("returns 200 with the completed skipped-round DTO passthrough, including the target", async () => {
    const res = await POST(req(VALID_ROUND_ID), params(VALID_ROUND_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ round: COMPLETED_ROUND });
    expect(body.round.status).toBe("skipped");
    expect(body.round.target).toBeTruthy();
  });

  it("maps an unexpected engine throw to 500 server_error with no DB detail leaked", async () => {
    skipRoundMock.mockRejectedValue(new Error("relation signal_scout_rounds violates secret constraint xyz"));
    const res = await POST(req(VALID_ROUND_ID), params(VALID_ROUND_ID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "server_error" });
    expect(JSON.stringify(body)).not.toContain("secret constraint");
  });

  it("never sets a Set-Cookie header on any response", async () => {
    const responses = await Promise.all([
      POST(req(VALID_ROUND_ID, {}), params(VALID_ROUND_ID)),
      POST(req("not-a-uuid"), params("not-a-uuid")),
      POST(req(VALID_ROUND_ID), params(VALID_ROUND_ID)),
    ]);
    for (const res of responses) {
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });
});
