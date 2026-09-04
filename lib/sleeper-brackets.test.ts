import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getSleeperWinnersBracket,
  getSleeperLosersBracket,
  bracketChampion,
  getSleeperDraftAutopickers,
  type SleeperBracketMatch,
} from "./sleeper";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Matches the shape safeFetch's readCapped expects: no body reader, so it falls back to text(). */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("getSleeperWinnersBracket", () => {
  it("parses a real-shaped payload", async () => {
    const payload: SleeperBracketMatch[] = [
      { m: 1, r: 1, l: 6, w: 2, t1: 2, t2: 6 },
      {
        m: 6,
        p: 1,
        r: 3,
        l: 2,
        w: 7,
        t1: 2,
        t2: 7,
        t2_from: { w: 4 },
        t1_from: { w: 3 },
      },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(200, payload));
    const result = await getSleeperWinnersBracket("123");
    expect(result).toEqual(payload);
  });

  it("returns null on a failed request, never an empty bracket", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "boom" }));
    const result = await getSleeperWinnersBracket("123");
    expect(result).toBeNull();
  });

  it("returns [] when Sleeper answers with no bracket, and this is NOT the same as null", async () => {
    // A league whose season has not ended yet, or that runs no playoffs, gets
    // an honest empty array from Sleeper. Reading that as null would make a
    // real answer look like a failed request, and reading a failed request as
    // [] would make it look like the league never had a champion. Both are
    // false claims about the league, so the two must be asserted separately.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    const result = await getSleeperWinnersBracket("123");
    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });

  it("encodes the league id into the path", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    await getSleeperWinnersBracket("abc/../xyz");
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(encodeURIComponent("abc/../xyz"));
  });
});

describe("getSleeperLosersBracket", () => {
  it("hits the losers_bracket path and shares the null-vs-empty contract", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    const empty = await getSleeperLosersBracket("123");
    expect(empty).toEqual([]);

    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: "throttled" }));
    const failed = await getSleeperLosersBracket("123");
    expect(failed).toBeNull();

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/losers_bracket");
  });
});

describe("bracketChampion", () => {
  it("finds the p:1 match and reads its winner and loser", () => {
    const bracket: SleeperBracketMatch[] = [
      { m: 1, r: 1, l: 6, w: 2, t1: 2, t2: 6 },
      { m: 6, p: 1, r: 3, l: 2, w: 7, t1: 2, t2: 7 },
    ];
    expect(bracketChampion(bracket)).toEqual({
      championRosterId: 7,
      runnerUpRosterId: 2,
    });
  });

  it("returns nulls when no match carries p:1", () => {
    const bracket: SleeperBracketMatch[] = [{ m: 1, r: 1, l: 6, w: 2, t1: 2, t2: 6 }];
    expect(bracketChampion(bracket)).toEqual({
      championRosterId: null,
      runnerUpRosterId: null,
    });
  });

  it("returns nulls when the title match has not been played (w is null)", () => {
    const bracket: SleeperBracketMatch[] = [
      { m: 6, p: 1, r: 3, l: null, w: null, t1: 2, t2: 7 },
    ];
    expect(bracketChampion(bracket)).toEqual({
      championRosterId: null,
      runnerUpRosterId: null,
    });
  });

  it("returns nulls for a null bracket", () => {
    expect(bracketChampion(null)).toEqual({
      championRosterId: null,
      runnerUpRosterId: null,
    });
  });

  it("does not fall back to the last round when p:1 is missing", () => {
    // A three-round bracket where the last round played decides third place,
    // not the title. Falling back to "highest round" would misname the
    // champion here.
    const bracket: SleeperBracketMatch[] = [
      { m: 1, r: 1, l: 6, w: 2, t1: 2, t2: 6 },
      { m: 5, p: 3, r: 3, l: 3, w: 4, t1: 3, t2: 4 },
    ];
    expect(bracketChampion(bracket)).toEqual({
      championRosterId: null,
      runnerUpRosterId: null,
    });
  });
});

describe("getSleeperDraftAutopickers", () => {
  function graphqlResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  it("returns the autopicker id array on the happy path", async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse(200, { data: { draft_autopickers: ["111", "222"] } }),
    );
    const result = await getSleeperDraftAutopickers("123456");
    expect(result).toEqual(["111", "222"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://sleeper.com/graphql");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("123456");
  });

  it("returns [] as-is when a completed draft has no autopickers", async () => {
    fetchMock.mockResolvedValueOnce(graphqlResponse(200, { data: { draft_autopickers: [] } }));
    const result = await getSleeperDraftAutopickers("123456");
    expect(result).toEqual([]);
  });

  it("returns null when the GraphQL body carries an errors array", async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse(200, { data: null, errors: [{ message: "bad query" }] }),
    );
    const result = await getSleeperDraftAutopickers("123456");
    expect(result).toBeNull();
  });

  it("returns null when data.draft_autopickers is not an array", async () => {
    fetchMock.mockResolvedValueOnce(graphqlResponse(200, { data: { draft_autopickers: "nope" } }));
    const result = await getSleeperDraftAutopickers("123456");
    expect(result).toBeNull();
  });

  it("returns null when the array holds non-string entries", async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse(200, { data: { draft_autopickers: [111, 222] } }),
    );
    const result = await getSleeperDraftAutopickers("123456");
    expect(result).toBeNull();
  });

  it("returns null on a non-200 response", async () => {
    fetchMock.mockResolvedValueOnce(graphqlResponse(500, { error: "boom" }));
    const result = await getSleeperDraftAutopickers("123456");
    expect(result).toBeNull();
  });

  it("returns null for a non-numeric draft id WITHOUT calling fetch", async () => {
    const result = await getSleeperDraftAutopickers("123; DROP TABLE drafts");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for an empty draft id WITHOUT calling fetch", async () => {
    const result = await getSleeperDraftAutopickers("");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
