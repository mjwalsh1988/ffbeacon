import { describe, it, expect, vi, beforeEach } from "vitest";

const { createAdminClientMock, getUserMock, getRoundMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getUserMock: vi.fn(),
  getRoundMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: createAdminClientMock,
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("@/lib/signal-scout/round-engine", () => ({
  getRound: getRoundMock,
}));

import { GET } from "./route";

const VALID_ROUND_ID = "11111111-1111-4111-8111-111111111111";

function req(
  id: string,
  headers: Record<string, string> = { "x-requested-with": "ff-beacon" },
): Request {
  return new Request(`http://test/api/games/signal-scout/round/${id}`, { headers });
}

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({});
  getUserMock.mockResolvedValue({ data: { user: null } });
  getRoundMock.mockResolvedValue({ ok: true, round: { roundId: VALID_ROUND_ID, status: "active" } });
});

describe("GET /api/games/signal-scout/round/[id]", () => {
  it("rejects a missing x-requested-with header with 403 and does nothing else", async () => {
    const res = await GET(req(VALID_ROUND_ID, {}), params(VALID_ROUND_ID));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(getRoundMock).not.toHaveBeenCalled();
  });

  it("returns 404 not_found for a malformed id without calling getRound", async () => {
    const res = await GET(req("not-a-uuid"), params("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(getRoundMock).not.toHaveBeenCalled();
  });

  it("returns 404 not_found for an unowned or unknown round", async () => {
    getRoundMock.mockResolvedValue({ ok: false, code: "not_found" });
    const res = await GET(req(VALID_ROUND_ID), params(VALID_ROUND_ID));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 200 with the active round DTO passthrough", async () => {
    const round = { roundId: VALID_ROUND_ID, status: "active", score: 1000 };
    getRoundMock.mockResolvedValue({ ok: true, round });
    const res = await GET(req(VALID_ROUND_ID), params(VALID_ROUND_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ round });
  });

  it("returns 200 with the completed round DTO passthrough", async () => {
    const round = { roundId: VALID_ROUND_ID, status: "won", scoreAwarded: 750 };
    getRoundMock.mockResolvedValue({ ok: true, round });
    const res = await GET(req(VALID_ROUND_ID), params(VALID_ROUND_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ round });
  });

  it("maps an unexpected engine throw to 500 server_error with no DB detail leaked", async () => {
    getRoundMock.mockRejectedValue(new Error("relation signal_scout_rounds violates secret constraint xyz"));
    const res = await GET(req(VALID_ROUND_ID), params(VALID_ROUND_ID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "server_error" });
    expect(JSON.stringify(body)).not.toContain("secret constraint");
  });

  it("never sets a Set-Cookie header on any response", async () => {
    const responses = await Promise.all([
      GET(req(VALID_ROUND_ID, {}), params(VALID_ROUND_ID)),
      GET(req("not-a-uuid"), params("not-a-uuid")),
      GET(req(VALID_ROUND_ID), params(VALID_ROUND_ID)),
    ]);
    for (const res of responses) {
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });
});
