import { describe, it, expect, vi } from "vitest";
import {
  joinSharedDerivedPass,
  LEAGUE_POWER_RANKINGS_TTL_MS,
  orphanRowIds,
  powerRankingsAreStale,
  transactionWeek,
} from "./league-pulse";

/**
 * The rule that keeps our copy of a league the same shape as Sleeper's.
 *
 * Every child write in league-pulse.ts is an upsert, so a team or a member that
 * disappears from Sleeper is never touched again and never leaves. A 16-team
 * league cut to 12 kept four ownerless roster rows, and Power Pulse went on
 * simulating a 16-team bracket against a 12-team schedule.
 */
describe("orphanRowIds", () => {
  const stored = [
    { id: "a", key: 1 },
    { id: "b", key: 2 },
    { id: "c", key: 13 },
    { id: "d", key: 14 },
  ];

  it("returns the rows the payload does not name", () => {
    expect(orphanRowIds(stored, [1, 2])).toEqual(["c", "d"]);
  });

  it("returns nothing when the payload names every stored row", () => {
    expect(orphanRowIds(stored, [1, 2, 13, 14])).toEqual([]);
  });

  it("ignores keys the payload adds that we have not stored yet", () => {
    expect(orphanRowIds(stored, [1, 2, 13, 14, 15])).toEqual([]);
  });

  it("compares a number key and a string key as the same key", () => {
    // Sleeper sends roster ids as numbers and user ids as numeric strings.
    expect(orphanRowIds([{ id: "a", key: 7 }], ["7"])).toEqual([]);
    expect(orphanRowIds([{ id: "a", key: "7" }], [7])).toEqual([]);
  });

  it("treats a null stored key as unmatched", () => {
    expect(orphanRowIds([{ id: "a", key: null }], [1, 2])).toEqual(["a"]);
  });

  /**
   * GUARD. lib/sleeper.ts collapses a failed request into `[]`, so an empty
   * payload means either "Sleeper has no rows" or "Sleeper did not answer" and
   * nothing here can tell those apart. This function will happily call every
   * stored row an orphan when handed an empty list, which is why both callers
   * return early first.
   *
   * If you are reading this because you moved the empty check, put it back. The
   * cost of getting it wrong is deleting a healthy league on one timeout.
   */
  it("would delete everything on an empty payload, which is why callers guard first", () => {
    expect(orphanRowIds(stored, [])).toEqual(["a", "b", "c", "d"]);
  });
});

describe("transactionWeek", () => {
  it("reads Sleeper's `leg`, which is the field that actually arrives", () => {
    // THE BUG THIS CLOSES. The row was built with `t.week ?? null` and Sleeper
    // sends `leg`, so every one of the 23,847 stored transactions had a null
    // week. That emptied the Transactions page's week filter, left every row
    // without its week, and made the incremental sync resume from week 0 on
    // every single resync instead of from the newest week it already held.
    expect(transactionWeek({ leg: 7 })).toBe(7);
  });

  it("prefers `week` if Sleeper ever populates it", () => {
    expect(transactionWeek({ week: 3, leg: 7 })).toBe(3);
  });

  it("falls through to leg when week is null", () => {
    expect(transactionWeek({ week: null, leg: 7 })).toBe(7);
  });

  it("returns null rather than a zero that would sort ahead of week 1", () => {
    expect(transactionWeek({})).toBeNull();
    expect(transactionWeek({ week: 0, leg: 0 })).toBeNull();
    expect(transactionWeek({ leg: -1 })).toBeNull();
  });
});

/**
 * A finished league's trade values stop moving.
 *
 * These rankings are the one League Pulse surface priced off a market that
 * keeps running after a league stops playing. Everything else is already
 * fixed: the Manager Ledger reads settled weeks, Schedules holds final scores,
 * and Power Pulse and Positional WAR refuse to compute without a remaining
 * schedule. Without this gate, a reader coming back to a league they won in
 * December would find their roster revalued by a rookie class they never had.
 */
describe("powerRankingsAreStale", () => {
  /** One row's worth of fake PostgREST, for the single query this makes. */
  function client(generatedAt: string | null) {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () =>
        Promise.resolve({
          data: generatedAt === null ? null : { generated_at: generatedAt },
          error: null,
        }),
    };
    return { from: () => builder } as never;
  }

  const fresh = new Date().toISOString();
  const old = new Date(Date.now() - LEAGUE_POWER_RANKINGS_TTL_MS - 1000).toISOString();

  it("recomputes when the league has no rows yet", async () => {
    expect(await powerRankingsAreStale(client(null), "league-1", false)).toBe(true);
  });

  it("recomputes a finished league that has no rows yet", async () => {
    // Freezing an empty table would leave a finished league with no rankings
    // at all rather than with its final ones.
    expect(await powerRankingsAreStale(client(null), "league-1", true)).toBe(true);
  });

  it("recomputes an in-season league once the rows pass the TTL", async () => {
    expect(await powerRankingsAreStale(client(old), "league-1", false)).toBe(true);
  });

  it("leaves an in-season league alone inside the TTL", async () => {
    expect(await powerRankingsAreStale(client(fresh), "league-1", false)).toBe(false);
  });

  it("freezes a finished league however old its rows are", async () => {
    const ancient = new Date("2025-12-30T12:00:00Z").toISOString();
    expect(await powerRankingsAreStale(client(ancient), "league-1", true)).toBe(false);
  });

  it("recomputes an in-season league inside the TTL when the rosters changed after its rows", async () => {
    const before = new Date(Date.now() - 60_000).toISOString();
    const after = new Date().toISOString();
    expect(await powerRankingsAreStale(client(before), "league-1", false, after)).toBe(true);
  });

  it("leaves a league alone when the roster change predates its rows", async () => {
    const changed = new Date(Date.now() - 60_000).toISOString();
    expect(await powerRankingsAreStale(client(fresh), "league-1", false, changed)).toBe(false);
  });

  it("keeps a finished league frozen even after a roster change", async () => {
    const ancient = new Date("2025-12-30T12:00:00Z").toISOString();
    expect(await powerRankingsAreStale(client(ancient), "league-1", true, fresh)).toBe(false);
  });
});

/**
 * Concurrent derived passes for one league share one run of the shared half,
 * whatever optional flags each caller passes: the hover warm-up and the page it
 * warms used to start two.
 */
describe("joinSharedDerivedPass", () => {
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("a second caller wanting the same or less joins the pass in flight", async () => {
    const gate = deferred();
    const run = vi.fn(() => gate.promise);
    const a = joinSharedDerivedPass("league-a", { syncs: true, force: false }, run);
    const b = joinSharedDerivedPass("league-a", { syncs: false, force: false }, run);
    gate.resolve();
    await Promise.all([a, b]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a caller owed a transaction pull waits out a pass that skips it, then runs its own", async () => {
    const gate = deferred();
    const calls: Array<{ syncs: boolean; force: boolean }> = [];
    const run = vi.fn(async (wants: { syncs: boolean; force: boolean }) => {
      calls.push(wants);
      if (calls.length === 1) await gate.promise;
    });
    const a = joinSharedDerivedPass("league-b", { syncs: false, force: false }, run);
    const b = joinSharedDerivedPass("league-b", { syncs: true, force: false }, run);
    // Not beside it: the second run has not started while the first is open.
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all([a, b]);
    expect(calls).toEqual([
      { syncs: false, force: false },
      { syncs: true, force: false },
    ]);
  });

  it("different leagues never share", async () => {
    const run = vi.fn(() => Promise.resolve());
    await Promise.all([
      joinSharedDerivedPass("league-c", { syncs: false, force: false }, run),
      joinSharedDerivedPass("league-d", { syncs: false, force: false }, run),
    ]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a pass that failed does not stop the next caller", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);
    await expect(
      joinSharedDerivedPass("league-e", { syncs: false, force: false }, run),
    ).rejects.toThrow("boom");
    await joinSharedDerivedPass("league-e", { syncs: false, force: false }, run);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
