import { describe, expect, it, vi } from "vitest";

/**
 * The stat line reader pages past PostgREST's 1000-row cap. The fake cuts
 * every read at 1000 rows the way the real server does, and a week here has
 * 1,500 players, so a reader that forgot to page would fail.
 */

const SERVER_MAX_ROWS = 1000;
const TOTAL = 1500;
const ranges: [number, number][] = [];

function fakeClient() {
  const rows = Array.from({ length: TOTAL }, (_, i) => ({
    id: String(i).padStart(6, "0"),
    stats: { rec: 1, rec_yd: 10 + (i % 7), pts_ppr: 99, pts_idp: 12, adp_ppr: 4, gp: 1, pts_allow_0: 1, pts_allow: 0 },
    players: { sleeper_id: String(1000 + i) },
  }));
  const builder = {
    _range: [0, SERVER_MAX_ROWS - 1] as [number, number],
    select: () => builder,
    eq: () => builder,
    gt: () => builder,
    in: () => builder,
    order: () => builder,
    range(from: number, to: number) {
      builder._range = [from, to];
      ranges.push([from, to]);
      return builder;
    },
    then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
      const [from, to] = builder._range;
      const end = Math.min(to + 1, from + SERVER_MAX_ROWS);
      return Promise.resolve({ data: rows.slice(from, end), error: null }).then(resolve);
    },
  };
  return { from: () => builder };
}

vi.mock("@/lib/supabase/server", () => ({
  createCachedReadClient: () => fakeClient(),
  createAdminClient: () => fakeClient(),
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));

import { readWeekLines } from "./load";

describe("readWeekLines", () => {
  it("reads every row of a week past the 1000-row cap", async () => {
    const lines = await readWeekLines(2026, 6);
    expect(lines).toHaveLength(TOTAL);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("keeps only scorable numbers, a defense's points-allowed buckets included", async () => {
    const [first] = await readWeekLines(2026, 6);
    expect(first.sleeperId).toBe("1000");
    // pts_ppr and pts_idp are Sleeper's own totals; pts_allow_0 is a scoring key.
    expect(first.stats).toEqual({ rec: 1, rec_yd: 10, pts_allow_0: 1 });
  });
});
