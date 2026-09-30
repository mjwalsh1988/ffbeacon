import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { cachedWeeklySource, readCachedWeekly } = await import("./load");

type Row = {
  roster_id: string;
  weekly: unknown;
  model_version: string | null;
  rosters: { sleeper_roster_id: number };
};

function clientWith(rows: Row[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    then: (onFulfilled: (v: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onFulfilled),
  };
  return { from: () => builder } as unknown as Parameters<typeof readCachedWeekly>[0];
}

const weekly = [{ week: 5, mean: 110, sigma: 20 }];

describe("cachedWeeklySource", () => {
  it("reads the source after the last colon", () => {
    expect(cachedWeeklySource("pulse-7:abc123:ffbeacon")).toBe("ffbeacon");
    expect(cachedWeeklySource("pulse-7:sleeper")).toBe("sleeper");
  });

  it("returns null for a row written before the source was folded in", () => {
    expect(cachedWeeklySource("pulse-7")).toBeNull();
    expect(cachedWeeklySource("pulse-7:")).toBeNull();
    expect(cachedWeeklySource(null)).toBeNull();
  });
});

describe("readCachedWeekly", () => {
  const rows: Row[] = [
    { roster_id: "a", weekly, model_version: "v1:sleeper", rosters: { sleeper_roster_id: 1 } },
    { roster_id: "b", weekly, model_version: "v1:ffbeacon", rosters: { sleeper_roster_id: 2 } },
    { roster_id: "c", weekly, model_version: "v1", rosters: { sleeper_roster_id: 3 } },
  ];

  it("keeps only rows built on the expected projection source", async () => {
    const out = await readCachedWeekly(clientWith(rows), "league", 2026, "sleeper");
    expect([...out.weekly.keys()]).toEqual([1]);
    expect(out.mismatchedSource).toBe(2);
  });

  it("keeps every row when no source is asked for", async () => {
    const out = await readCachedWeekly(clientWith(rows), "league", 2026);
    expect([...out.weekly.keys()].sort()).toEqual([1, 2, 3]);
    expect(out.mismatchedSource).toBe(0);
    expect(out.weekly.get(1)?.get(5)).toEqual({ mean: 110, sigma: 20 });
  });
});
