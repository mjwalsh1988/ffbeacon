import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSleeperUser } from "./sleeper";
import {
  acquireSleeperToken,
  countSleeperCalls,
  pauseSleeperBudget,
  _resetSleeperBudgetForTests,
} from "./sleeper-budget";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  _resetSleeperBudgetForTests(600);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Matches the shape safeFetch's readCapped expects: no body reader, so it falls back to text(). */
function jsonResponse(status: number, body: unknown, headerMap: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => headerMap[key.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("safeFetch (via getSleeperUser)", () => {
  it("outside a queue job, a 429 returns null on the first refusal with no retry", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "10" }));

    const result = await getSleeperUser("a");

    expect(result).toBeNull();
    // No wait for Retry-After and no second attempt: an interactive caller is
    // not made to block on a URL that just told us to slow down.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("outside a queue job, a single 429 does not pause the shared budget for other callers", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "10" }));
    await getSleeperUser("a");

    let resolved = false;
    const pending = acquireSleeperToken().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(resolved).toBe(true);
  });

  it("inside a queue job, a 429 then a 200 retries after Retry-After and returns the body", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "2" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { user_id: "1", username: "a", display_name: "A", avatar: null }),
      );

    const { result } = await countSleeperCalls(async () => {
      const promise = getSleeperUser("a");
      await vi.advanceTimersByTimeAsync(2_000);
      return promise;
    });

    expect(result).toEqual({ user_id: "1", username: "a", display_name: "A", avatar: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("inside a queue job, two 429s return null, and the next acquireSleeperToken waits out the pause", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "1" }))
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "1" }));

    const { result } = await countSleeperCalls(async () => {
      const promise = getSleeperUser("a");
      await vi.advanceTimersByTimeAsync(1_000);
      return promise;
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The second refusal pauses the whole budget for at least 10s (the floor
    // in safeFetch), so the next caller, however unrelated, must wait too.
    // Waited out inside a job context so the interactive deadline does not
    // cut this wait short.
    const { result: resolved } = await countSleeperCalls(async () => {
      let done = false;
      const pending = acquireSleeperToken().then(() => {
        done = true;
      });

      await vi.advanceTimersByTimeAsync(5_000);
      expect(done).toBe(false);

      await vi.advanceTimersByTimeAsync(6_000);
      await pending;
      return done;
    });
    expect(resolved).toBe(true);
  });

  it("a 404 returns null with no retry, in or out of a job", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not found" }));

    const result = await getSleeperUser("a");

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("outside a queue job, a starved token budget returns null instead of blocking the render", async () => {
    // Drain the burst capacity so the very next acquire has to wait for a refill,
    // then pause on top of that; the interactive deadline should still cut it
    // short well before either resolves on its own.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, {}, { "retry-after": "1" }),
    );
    await getSleeperUser("a"); // consumes one token, uneventfully returns null

    pauseSleeperBudget(10_000);

    const promise = getSleeperUser("b");
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toBeNull();
    // Only the first call's fetch happened; the second never got a token in time.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
