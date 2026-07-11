import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startRound,
  fetchRound,
  purchaseHint,
  submitGuess,
  skipRound,
  searchPlayers,
  SCOUT_REQUEST_HEADER,
} from "./client";

/**
 * Covers the browser wrapper around the Signal Scout API routes: the header
 * guard and cache: "no-store" are attached on every call, success bodies are
 * parsed into the expected shape, error codes (which the routes send AS the
 * `error` string, not a derived HTTP-status mapping) come through typed with
 * a game-voice message, the 409 active_round_exists roundId survives the
 * round trip, malformed JSON never throws, and an unrecognized code falls
 * back to a generic message instead of crashing the caller.
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

describe("header and cache guard", () => {
  it("attaches x-requested-with and cache: no-store on every call", async () => {
    fetchMock.mockResolvedValue(res(200, { round: { roundId: "r1" } }));

    await startRound();
    await fetchRound("r1");
    await purchaseHint("r1", "weak", false);
    await submitGuess("r1", "p1");
    await skipRound("r1");
    await searchPlayers("mahomes");

    expect(fetchMock).toHaveBeenCalledTimes(6);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers["x-requested-with"]).toBe(SCOUT_REQUEST_HEADER["x-requested-with"]);
      expect(init.cache).toBe("no-store");
    }
  });
});

describe("startRound", () => {
  it("parses a successful round payload", async () => {
    const round = { roundId: "r1", score: 1000 };
    fetchMock.mockResolvedValueOnce(res(200, { round }));
    const result = await startRound();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.round).toEqual(round);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/games/signal-scout/round");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("surfaces active_round_exists with the roundId to resume", async () => {
    fetchMock.mockResolvedValueOnce(
      res(409, { error: "active_round_exists", roundId: "existing-round-id" }),
    );
    const result = await startRound();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("active_round_exists");
      expect(result.roundId).toBe("existing-round-id");
      expect(result.message).toBe("You already have a round in progress.");
    }
  });
});

describe("error code extraction", () => {
  it("maps a known error code to its game-voice message", async () => {
    fetchMock.mockResolvedValueOnce(res(429, { error: "rate_limited" }));
    const result = await submitGuess("r1", "p1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("rate_limited");
      expect(result.message).toBe("Too fast. Give the signal a second and try again.");
      expect(result.status).toBe(429);
    }
  });

  it("maps tier_limit_reached from a hint purchase", async () => {
    fetchMock.mockResolvedValueOnce(res(409, { error: "tier_limit_reached" }));
    const result = await purchaseHint("r1", "scan", false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("tier_limit_reached");
  });
});

describe("malformed responses", () => {
  it("treats an unparsable JSON body as an empty object and falls back to server_error", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("Unexpected end of input");
      },
    } as unknown as Response);
    const result = await skipRound("r1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("server_error");
      expect(result.message).toBe("Something went wrong. Try again shortly.");
    }
  });

  it("falls back to server_error's message for an error code the client does not recognize", async () => {
    fetchMock.mockResolvedValueOnce(res(500, { error: "some_new_backend_code" }));
    const result = await fetchRound("r1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("server_error");
      expect(result.message).toBe("Something went wrong. Try again shortly.");
    }
  });

  it("maps a rejected fetch (offline) to the network code", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const result = await startRound();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("network");
  });
});

describe("searchPlayers", () => {
  it("encodes the query and parses the results array", async () => {
    fetchMock.mockResolvedValueOnce(
      res(200, { results: [{ id: "p1", name: "Test Player", position: "WR", team: "KC", sleeperId: "123" }] }),
    );
    const result = await searchPlayers("test player");
    expect(String(fetchMock.mock.calls[0][0])).toContain("q=test+player");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.results).toHaveLength(1);
  });

  it("passes an AbortSignal through to fetch", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(res(200, { results: [] }));
    await searchPlayers("abc", { signal: controller.signal });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });
});
