import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  lookupSleeperLeague,
  getSleeperRostersOrNull,
  getSleeperLeagueUsersOrNull,
  getSleeperTradedPicksOrNull,
  getSleeperLeagueDraftsOrNull,
  getSleeperRosters,
  getWeeklyStatsOrNull,
  getWeeklyStats,
  getSleeperDraftAutopickers,
} from "./sleeper";
import { countSleeperCalls, _resetSleeperBudgetForTests } from "./sleeper-budget";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  _resetSleeperBudgetForTests(600);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Matches the shape safeFetch's readCapped expects: no body reader, so it falls back to text(). */
function rawResponse(status: number, text: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
  } as unknown as Response;
}

describe("lookupSleeperLeague", () => {
  it("returns found with the league", async () => {
    fetchMock.mockResolvedValueOnce(
      rawResponse(200, JSON.stringify({ league_id: "123", name: "L", season: "2026" })),
    );
    const result = await lookupSleeperLeague("123");
    expect(result.status).toBe("found");
    if (result.status === "found") expect(result.league.league_id).toBe("123");
  });

  it("reads Sleeper's 404 with a literal null body as not found", async () => {
    // Measured 2026-09-29: a deleted league answers HTTP 404 with body `null`.
    fetchMock.mockResolvedValueOnce(rawResponse(404, "null"));
    expect(await lookupSleeperLeague("123")).toEqual({ status: "not_found" });
  });

  it("reads a 200 with a null body as not found", async () => {
    fetchMock.mockResolvedValueOnce(rawResponse(200, "null"));
    expect(await lookupSleeperLeague("123")).toEqual({ status: "not_found" });
  });

  it("treats a 404 with any other body as a failed request, never as not found", async () => {
    fetchMock.mockResolvedValueOnce(rawResponse(404, "<html>edge error</html>"));
    expect(await lookupSleeperLeague("123")).toEqual({ status: "failed" });
  });

  it.each([429, 500, 502, 503])("treats HTTP %i as a failed request", async (status) => {
    fetchMock.mockResolvedValueOnce(rawResponse(status, "null"));
    expect(await lookupSleeperLeague("123")).toEqual({ status: "failed" });
  });

  it("treats a thrown fetch (timeout, network) as a failed request", async () => {
    fetchMock.mockRejectedValueOnce(new Error("aborted"));
    expect(await lookupSleeperLeague("123")).toEqual({ status: "failed" });
  });

  it("treats a body that is neither a league nor null as a failed request", async () => {
    fetchMock.mockResolvedValueOnce(rawResponse(200, JSON.stringify({ error: "odd" })));
    expect(await lookupSleeperLeague("123")).toEqual({ status: "failed" });
  });
});

describe("the OrNull child fetches", () => {
  it.each([
    ["rosters", getSleeperRostersOrNull],
    ["users", getSleeperLeagueUsersOrNull],
    ["traded_picks", getSleeperTradedPicksOrNull],
    ["drafts", getSleeperLeagueDraftsOrNull],
  ] as const)("%s: null on a failed request, [] on an empty answer", async (_name, fn) => {
    fetchMock.mockResolvedValueOnce(rawResponse(500, "{}"));
    expect(await fn("123")).toBeNull();

    fetchMock.mockResolvedValueOnce(rawResponse(200, "[]"));
    expect(await fn("123")).toEqual([]);

    // Sleeper answers `null` for a league it does not know. That is not a
    // list of anything, empty or not.
    fetchMock.mockResolvedValueOnce(rawResponse(200, "null"));
    expect(await fn("123")).toBeNull();
  });

  it("keeps the old flattening for the callers that still use the plain variant", async () => {
    fetchMock.mockResolvedValueOnce(rawResponse(500, "{}"));
    expect(await getSleeperRosters("123")).toEqual([]);
  });
});

describe("getWeeklyStatsOrNull", () => {
  it("returns null on a failed request and [] on an empty week", async () => {
    fetchMock.mockResolvedValueOnce(rawResponse(503, "{}"));
    expect(await getWeeklyStatsOrNull("regular", 2026, 3)).toBeNull();

    fetchMock.mockResolvedValueOnce(rawResponse(200, "[]"));
    expect(await getWeeklyStatsOrNull("regular", 2026, 3)).toEqual([]);
  });

  it("the plain variant still flattens a failure to [] for the backfill script", async () => {
    fetchMock.mockResolvedValueOnce(rawResponse(500, "{}"));
    expect(await getWeeklyStats("regular", 2026, 3)).toEqual([]);
  });
});

describe("getSleeperDraftAutopickers goes through the Sleeper budget", () => {
  it("takes a budget token like every other Sleeper call", async () => {
    fetchMock.mockResolvedValueOnce(
      rawResponse(200, JSON.stringify({ data: { draft_autopickers: ["1"] } })),
    );
    const { result, calls } = await countSleeperCalls(() => getSleeperDraftAutopickers("123456"));
    expect(result).toEqual(["1"]);
    expect(calls).toBe(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
  });
});
