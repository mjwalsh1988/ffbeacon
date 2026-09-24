/**
 * Paging on the `player_value_trends` read.
 *
 * PostgREST caps a response at 1,000 rows and does not say so. The board
 * fetches one trends row per player for a (format, source) pair, which is 615
 * at the biggest live pairing, so the cap is not being hit today. Past it the
 * failure is silent and ugly: the players beyond row 1,000 keep their Value
 * (the chunked history fallback still finds it) and lose their tier, their
 * gap and both movement columns, on a board that looks entirely normal.
 *
 * These tests drive `loadRankingsBoard` through a chainable Supabase mock that
 * enforces the cap the way the real server does, so a regression to an unpaged
 * read fails here rather than in production a season from now. Same mock shape
 * as lib/on-the-clock/board-loader.test.ts.
 */

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadRankingsBoard } from "@/lib/rankings-board";

const FORMAT = "fmt-1";
const SOURCE = "ffbeacon";

function player(n: number) {
  return {
    id: `p-${n}`,
    slug: `player-${n}`,
    first_name: "Player",
    last_name: String(n),
    position: "WR",
    team: "BUF",
    status: "active",
    external_ids: { sleeper: String(n) },
  };
}

function trendRow(n: number) {
  return {
    player_id: `p-${n}`,
    current_value: 10000 - n,
    change_30d_pct: 1,
    trend_30d: "up",
    rank_change_30d: 2,
    show_trend_30d: true,
    high_30d: 10000,
    low_30d: 9000,
    change_7d_pct: 0.5,
    rank_change_7d: 1,
    show_trend_7d: true,
  };
}

type MockOptions = {
  /** How many ranked players exist for the (format, source). The mock pages
   *  them under the same 1,000 row cap as the trends read. */
  rankedCount: number;
  /** Position for ranked player n. Defaults to WR for everyone. */
  positionOf?: (n: number) => string;
  /** How many trends rows exist in total for the (format, source). */
  trendCount: number;
  /** Page index (0-based) whose request should fail. */
  failPage?: number;
};

type Recorded = { table: string; range?: [number, number] };

function mockSupabase(opts: MockOptions) {
  const calls: Recorded[] = [];
  /** The server's hard cap. A request for more than this many rows gets this
   *  many, which is exactly the behaviour an unpaged read walks into. */
  const SERVER_MAX_ROWS = 1000;

  function builder(table: string) {
    const state: { range?: [number, number] } = {};
    const record = () => calls.push({ table, range: state.range });

    const result = () => {
      if (table === "rankings") {
        const [from, to] = state.range ?? [0, SERVER_MAX_ROWS - 1];
        record();
        const width = Math.min(to - from + 1, SERVER_MAX_ROWS);
        return {
          data: Array.from(
            { length: Math.max(0, Math.min(width, opts.rankedCount - from)) },
            (_, i) => ({
              overall_rank: from + i + 1,
              position_rank: from + i + 1,
              players: {
                ...player(from + i),
                position: opts.positionOf?.(from + i) ?? "WR",
              },
            }),
          ),
          error: null,
        };
      }
      if (table === "player_value_trends") {
        const [from, to] = state.range ?? [0, SERVER_MAX_ROWS - 1];
        const pageIndex = Math.floor(from / SERVER_MAX_ROWS);
        record();
        if (opts.failPage === pageIndex) {
          return { data: null, error: { message: "boom" } };
        }
        const width = Math.min(to - from + 1, SERVER_MAX_ROWS);
        const slice = Array.from(
          { length: Math.max(0, Math.min(width, opts.trendCount - from)) },
          (_, i) => trendRow(from + i),
        );
        return { data: slice, error: null };
      }
      if (table === "player_value_history") {
        record();
        return { data: [{ captured_at: "2026-09-21T12:00:00Z" }], error: null };
      }
      return { data: [], error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      is: () => b,
      in: () => b,
      gte: () => b,
      order: () => b,
      limit: () => b,
      range: (from: number, to: number) => {
        state.range = [from, to];
        return b;
      },
      maybeSingle: () => Promise.resolve(result()),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(res, rej),
    };
    return b;
  }

  const client = { from: (table: string) => builder(table) };
  return {
    client: client as unknown as SupabaseClient<Database>,
    calls,
    trendPages: () => calls.filter((c) => c.table === "player_value_trends"),
  };
}

function load(mock: ReturnType<typeof mockSupabase>) {
  return loadRankingsBoard(mock.client, {
    formatConfigId: FORMAT,
    rankingsSource: SOURCE,
    valueHistorySource: SOURCE,
  });
}

describe("loadRankingsBoard trends paging", () => {
  it("asks for one page when the source has fewer rows than the cap", async () => {
    // 615 is the real high-water mark across every live (format, source).
    const mock = mockSupabase({ rankedCount: 500, trendCount: 615 });
    const board = await load(mock);

    expect(mock.trendPages()).toHaveLength(1);
    expect(mock.trendPages()[0].range).toEqual([0, 999]);
    expect(board.rows).toHaveLength(500);
    expect(board.rows.every((r) => r.value !== null)).toBe(true);
  });

  it("keeps every player's movement columns past the 1,000 row cap", async () => {
    // The whole point. Ranked player 1,200 has a trends row at index 1,200,
    // which an unpaged read never receives.
    const mock = mockSupabase({ rankedCount: 1400, trendCount: 1400 });
    const board = await load(mock);

    expect(mock.trendPages().map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    const late = board.rows.find((r) => r.slug === "player-1200");
    expect(late?.value).toBe(10000 - 1200);
    expect(late?.show_trend_30d).toBe(true);
    expect(late?.rank_change_30d).toBe(2);
    expect(board.rows.every((r) => r.show_trend_30d)).toBe(true);
  });

  it("stops after a page that comes back exactly full but empties", async () => {
    // Exactly 1,000 rows: the first page is full, so a second is requested,
    // it comes back empty, and the loop ends. No infinite paging.
    const mock = mockSupabase({ rankedCount: 500, trendCount: 1000 });
    await load(mock);
    expect(mock.trendPages()).toHaveLength(2);
    expect(mock.trendPages()[1].range).toEqual([1000, 1999]);
  });

  it("drops every trend row when a later page fails, rather than keeping some", async () => {
    // The board still renders (a missing trend degrades to a dash), but it
    // never mixes players with movement columns and players silently without.
    const mock = mockSupabase({
      rankedCount: 1400,
      trendCount: 1400,
      failPage: 1,
    });
    const board = await load(mock);

    expect(board.rows).toHaveLength(1400);
    expect(board.rows.find((r) => r.slug === "player-10")?.show_trend_30d).toBe(
      false,
    );
    expect(
      board.rows.find((r) => r.slug === "player-1200")?.show_trend_30d,
    ).toBe(false);
  });

  it("returns every ranked player, so a position view is not cut at rank 500", async () => {
    // Every third player is a TE. Before paging, the read stopped at 500 and
    // the in-memory position filter lost every TE ranked below it.
    const mock = mockSupabase({
      rankedCount: 1200,
      trendCount: 0,
      positionOf: (n) => (n % 3 === 0 ? "TE" : "WR"),
    });
    const board = await load(mock);

    expect(board.rows).toHaveLength(1200);
    const tes = board.rows.filter((r) => r.position === "TE");
    expect(tes).toHaveLength(400);
    expect(tes.at(-1)?.overall_rank).toBe(1198);
  });

  it("makes no trends request at all when there is no value source", async () => {
    const mock = mockSupabase({ rankedCount: 10, trendCount: 100 });
    const board = await loadRankingsBoard(mock.client, {
      formatConfigId: FORMAT,
      rankingsSource: SOURCE,
      valueHistorySource: null,
    });
    expect(mock.trendPages()).toHaveLength(0);
    expect(board.rows).toHaveLength(10);
    expect(board.lastCapturedAt).toBeNull();
  });
});
