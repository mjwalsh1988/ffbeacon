import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchLeagues, fetchDraft, syncDraft, OTC_REQUEST_HEADER } from "./client";

/**
 * These cover the client-side route wrappers: the username/lookup flow calls the
 * leagues route (never Sleeper directly), bad responses map to clean UI error
 * states, the sync wrapper passes the status union through, and EACH call makes
 * exactly one fetch (no polling is introduced anywhere).
 */

const fetchMock = vi.fn();

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchLeagues", () => {
  it("hits the leagues route with the header guard and returns shaped data", async () => {
    fetchMock.mockResolvedValueOnce(
      res(200, { ok: true, season: "2026", userId: "u1", leagues: [{ leagueId: "L1" }], truncated: false }),
    );
    const result = await fetchLeagues("Mike", "2026");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/on-the-clock/leagues?");
    expect(String(url)).toContain("username=Mike");
    expect((init.headers as Record<string, string>)["x-requested-with"]).toBe(
      OTC_REQUEST_HEADER["x-requested-with"],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.userId).toBe("u1");
      expect(result.data.leagues).toHaveLength(1);
    }
  });

  it("maps 503 to feature-disabled with the route message", async () => {
    fetchMock.mockResolvedValueOnce(res(503, { error: "On The Clock is not available yet." }));
    const result = await fetchLeagues("Mike", "2026");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("feature-disabled");
      expect(result.message).toBe("On The Clock is not available yet.");
    }
  });

  it("maps 429 to throttled and 404 to not-found", async () => {
    fetchMock.mockResolvedValueOnce(res(429, { error: "Too many lookups." }));
    const throttled = await fetchLeagues("Mike", "2026");
    expect(throttled.ok).toBe(false);
    if (!throttled.ok) expect(throttled.code).toBe("throttled");

    fetchMock.mockResolvedValueOnce(res(404, { error: "We could not find a Sleeper user with that name." }));
    const missing = await fetchLeagues("Ghost", "2026");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("not-found");
  });

  it("maps a network failure to the network code", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const result = await fetchLeagues("Mike", "2026");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("network");
  });
});

describe("fetchDraft", () => {
  it("requests the read route once and returns the cache", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { ok: true, cache: { draft: {}, users: [], rosters: [], picks: [] } }));
    const result = await fetchDraft("123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("draft_id=123");
    expect(result.ok).toBe(true);
  });

  it("maps 404 to a clean not-found state", async () => {
    fetchMock.mockResolvedValueOnce(res(404, { error: "We could not load that draft." }));
    const result = await fetchDraft("123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not-found");
  });
});

describe("syncDraft", () => {
  it("POSTs draft_id + league_id + season and passes the status union through", async () => {
    fetchMock.mockResolvedValueOnce(
      res(200, { ok: true, status: "synced", cooldownRemainingSeconds: 0, lastSyncedAt: "2026-06-26T12:00:00Z", cache: null }),
    );
    const result = await syncDraft({ draftId: "123", leagueId: "456", season: "2026" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ draft_id: "123", league_id: "456", season: "2026" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("synced");
  });

  it.each(["cooldown", "synced-by-other", "served-cache", "error"] as const)(
    "passes the %s status through as a 200 result",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        res(200, { ok: status !== "error", status, cooldownRemainingSeconds: 12, lastSyncedAt: null, cache: null }),
      );
      const result = await syncDraft({ draftId: "123" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.status).toBe(status);
    },
  );

  it("surfaces a 500 as a server error (not a thrown exception)", async () => {
    fetchMock.mockResolvedValueOnce(res(500, { error: "Sync failed. Try again shortly." }));
    const result = await syncDraft({ draftId: "123" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("server");
  });
});
