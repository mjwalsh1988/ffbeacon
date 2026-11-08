import { describe, expect, it } from "vitest";
import { boardCacheKey, mapRows, queryBoardRows, type Board } from "./leaderboards";

/** A recording query builder: captures order and filters, returns no rows. */
function recorder() {
  const log: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
  const admin = {
    from(table: string) {
      const entry = { table, ops: [] as Array<[string, unknown[]]> };
      log.push(entry);
      const api: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null })),
      };
      for (const op of ["select", "eq", "gt", "order", "not", "range"]) {
        api[op] = (...args: unknown[]) => {
          entry.ops.push([op, args]);
          return api;
        };
      }
      return api;
    },
  } as never;
  return { admin, log };
}

const orders = (ops: Array<[string, unknown[]]>) => ops.filter(([op]) => op === "order").map(([, a]) => a[0]);

describe("queryBoardRows ordering", () => {
  it("orders each board by its documented tie-breaks", async () => {
    const expected: Record<Board, string[]> = {
      daily: ["total_points", "completed_at", "id"],
      all_time: ["total_points", "days_played", "first_completed_at", "user_id"],
      streak: ["current_streak", "best_streak", "first_completed_at", "user_id"],
    };
    for (const board of Object.keys(expected) as Board[]) {
      const { admin, log } = recorder();
      await queryBoardRows(admin, board, 1, "2026-11-08", []);
      expect(orders(log[0].ops)).toEqual(expected[board]);
    }
  });

  it("applies the exclusion set as a not-in filter", async () => {
    const { admin, log } = recorder();
    await queryBoardRows(admin, "daily", 2, "2026-11-08", ["a", "b"]);
    expect(log[0].ops).toContainEqual(["not", ["user_id", "in", "(a,b)"]]);
    expect(log[0].ops).toContainEqual(["range", [25, 49]]);
  });

  it("reads Hurry-Up completions only on the daily board", async () => {
    const { admin, log } = recorder();
    await queryBoardRows(admin, "daily", 1, "2026-11-08", []);
    expect(log[0].ops).toContainEqual(["eq", ["mode", "hurry_up"]]);
    expect(log[0].ops).toContainEqual(["eq", ["status", "completed"]]);
  });
});

describe("mapRows", () => {
  const identities = new Map([
    ["u1", { displayName: "Ann", avatarUrl: null }],
    ["u2", { displayName: "Bo", avatarUrl: "https://x/a.png" }],
  ]);
  const handles = new Map([["u2", "bo"]]);
  const rows = mapRows(
    [
      { user_id: "u1", figure: 300, secondary: 0 },
      { user_id: "u2", figure: 250, secondary: 15 },
    ],
    2,
    "u1",
    identities,
    handles,
  );

  it("assigns page-aware ranks and marks the reader", () => {
    expect(rows.map((r) => r.rank)).toEqual([26, 27]);
    expect(rows[0].isYou).toBe(true);
  });

  it("links only live handles", () => {
    expect(rows[0].profileHref).toBeNull();
    expect(rows[1].profileHref).toBe("/u/bo");
  });

  it("never carries a raw user id", () => {
    expect(JSON.stringify(rows)).not.toMatch(/u1|u2/);
  });
});

describe("boardCacheKey", () => {
  it("keys the daily board on the requested date and the others on today", () => {
    expect(boardCacheKey("daily", "2026-11-07", "2026-11-08")).toContain("2026-11-07");
    expect(boardCacheKey("all_time", "2026-11-07", "2026-11-08")).toContain("2026-11-08");
  });
});
