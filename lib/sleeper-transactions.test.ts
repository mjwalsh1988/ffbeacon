import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAllSleeperTransactions, type SleeperTransaction } from "./sleeper";
import { _resetSleeperBudgetForTests } from "./sleeper-budget";

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
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function transaction(id: string): SleeperTransaction {
  return {
    transaction_id: id,
    type: "waiver",
    status: "complete",
    adds: null,
    drops: null,
  };
}

describe("getAllSleeperTransactions", () => {
  it("returns every week's transactions when every week answers", async () => {
    // Weeks 0-5 answer with one transaction each, then three empty weeks stop the walk.
    fetchMock.mockImplementation(async (url: string) => {
      const week = Number(url.split("/transactions/")[1]);
      const body = week <= 5 ? [transaction(`w${week}`)] : [];
      return jsonResponse(200, body);
    });

    const result = await getAllSleeperTransactions("league1", 10, 3, 0);

    expect(result.map((t) => t.transaction_id)).toEqual(["w0", "w1", "w2", "w3", "w4", "w5"]);
  });

  it("reads past a quiet stretch when the walk is bounded (emptyStop Infinity)", async () => {
    // A real 2024 league: nothing in weeks 0-7, moves in 8 through 17. The old
    // three-empty-weeks stop returned none of them.
    fetchMock.mockImplementation(async (url: string) => {
      const week = Number(url.split("/transactions/")[1]);
      return jsonResponse(200, week >= 8 && week <= 17 ? [transaction(`w${week}`)] : []);
    });

    const bounded = await getAllSleeperTransactions("league1", 18, Number.POSITIVE_INFINITY, 0);
    expect(bounded).toHaveLength(10);
    expect(bounded[0].transaction_id).toBe("w8");

    const guessed = await getAllSleeperTransactions("league1", 18, 3, 0);
    expect(guessed).toHaveLength(0);
  });

  it("throws when a week's request fails, rather than treating it as empty", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const week = Number(url.split("/transactions/")[1]);
      if (week === 2) return jsonResponse(503, { error: "throttled" });
      return jsonResponse(200, []);
    });

    const promise = getAllSleeperTransactions("league1", 10, 3, 0);
    // Attach the rejection expectation before advancing time, so the promise
    // is never unobserved between the throw and the assertion.
    const expectation = expect(promise).rejects.toThrow(
      "Sleeper did not answer for week 2 of league league1",
    );
    // Week 2's 503 is retried once by safeFetch (jittered 2-3s with no
    // Retry-After header) before the second refusal gives up on it.
    await vi.advanceTimersByTimeAsync(3_100);

    await expectation;
  });

  it("never returns [] for a failed week; a failure is a throw, not an empty result", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: "boom" }));

    await expect(getAllSleeperTransactions("league1", 2, 3, 0)).rejects.toThrow(/did not answer/);
  });
});
