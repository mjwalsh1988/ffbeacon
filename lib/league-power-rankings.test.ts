/**
 * Regression cover for the value loader's paging.
 *
 * This is the bug that made a league rank Bijan Robinson's owner last at running
 * back. The loader read a few thousand trend rows a page at a time using an
 * offset over an unsorted query, Postgres returned the rows in a different order
 * per request, and roughly one row in ten was skipped. A skipped row is a player
 * valued at zero, which no downstream check can tell apart from a real zero.
 *
 * The stub below reproduces exactly that hostile condition: it shuffles its rows
 * differently on every request. A loader that pages on a unique sorted key is
 * unaffected by that; one that pages on an offset is not. Anyone who removes the
 * ordering, or advances the cursor wrongly, fails these tests.
 */

import { describe, expect, it } from "vitest";
import { loadPlayerValueMaps } from "./league-power-rankings";

type Row = {
  id: string;
  player_id: string;
  current_value: number;
  format_config_id: string;
  source: string;
};

const SOURCE = "ffbeacon";

/** Rows for `players` x `combos`, ids ordered so sorting by id is meaningful. */
function makeRows(players: number, combos: number): Row[] {
  const rows: Row[] = [];
  for (let p = 0; p < players; p += 1) {
    for (let c = 0; c < combos; c += 1) {
      rows.push({
        id: "",
        player_id: `player-${String(p).padStart(4, "0")}`,
        // Distinct per (player, combo) so a dropped row is detectable by value.
        current_value: p * 100 + c,
        format_config_id: `format-${String(c).padStart(2, "0")}`,
        source: SOURCE,
      });
    }
  }
  rows.forEach((r, i) => {
    r.id = `row-${String(i).padStart(6, "0")}`;
  });
  return rows;
}

/**
 * A Supabase stand-in that answers correctly but never twice in the same order,
 * which is the behavior an unsorted paged read is not allowed to depend on.
 */
function shufflingStub(rows: Row[]) {
  let requests = 0;
  let sawOrderById = false;

  const build = () => {
    const state: {
      head: boolean;
      playerIds: string[] | null;
      ordered: boolean;
      gt: string | null;
      limit: number;
      from: number;
    } = {
      head: false,
      playerIds: null,
      ordered: false,
      gt: null,
      limit: rows.length,
      from: 0,
    };

    const run = () => {
      requests += 1;
      let matched = rows.filter((r) => !state.playerIds || state.playerIds.includes(r.player_id));
      if (state.head) return { data: null, count: matched.length, error: null };

      if (state.ordered) {
        matched = [...matched].sort((a, b) => a.id.localeCompare(b.id));
      } else {
        // Deliberately hostile: a fresh arbitrary order on every request.
        matched = [...matched].sort((a, b) =>
          ((requests * 31 + a.id.charCodeAt(6)) % 7) - ((requests * 17 + b.id.charCodeAt(6)) % 7),
        );
      }
      if (state.gt !== null) matched = matched.filter((r) => r.id > state.gt!);
      // `.range()` is supported so an implementation that goes back to offset
      // paging runs here rather than crashing, and drops rows exactly the way
      // the real database did.
      return {
        data: matched.slice(state.from, state.from + state.limit),
        count: null,
        error: null,
      };
    };

    const builder: Record<string, unknown> = {
      select(_cols: string, opts?: { count?: string; head?: boolean }) {
        state.head = Boolean(opts?.head);
        return builder;
      },
      in(_col: string, values: string[]) {
        state.playerIds = values;
        return builder;
      },
      order(col: string) {
        if (col === "id") {
          state.ordered = true;
          sawOrderById = true;
        }
        return builder;
      },
      limit(n: number) {
        state.limit = n;
        return builder;
      },
      gt(_col: string, value: string) {
        state.gt = value;
        return builder;
      },
      range(from: number, to: number) {
        state.from = from;
        state.limit = to - from + 1;
        return builder;
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve);
      },
    };
    return builder;
  };

  return {
    client: { from: () => build() },
    get requests() {
      return requests;
    },
    get sawOrderById() {
      return sawOrderById;
    },
  };
}

describe("loadPlayerValueMaps", () => {
  it("reads every row when the result spans several pages", async () => {
    // 200 players across 24 combos is one real chunk: 4,800 rows, five pages.
    const rows = makeRows(200, 24);
    const stub = shufflingStub(rows);
    const playerIds = Array.from(new Set(rows.map((r) => r.player_id)));

    const maps = await loadPlayerValueMaps(
      stub.client as never,
      playerIds,
    );

    let loaded = 0;
    for (const map of maps.values()) loaded += map.size;
    expect(loaded).toBe(rows.length);
    expect(stub.requests).toBeGreaterThan(2);
  });

  it("sorts on the primary key, which is what makes the paging sound", async () => {
    const rows = makeRows(200, 24);
    const stub = shufflingStub(rows);
    await loadPlayerValueMaps(
      stub.client as never,
      Array.from(new Set(rows.map((r) => r.player_id))),
    );
    expect(stub.sawOrderById).toBe(true);
  });

  it("keeps the right value against the right player and combo", async () => {
    const rows = makeRows(200, 24);
    const stub = shufflingStub(rows);
    const maps = await loadPlayerValueMaps(
      stub.client as never,
      Array.from(new Set(rows.map((r) => r.player_id))),
    );

    for (const row of rows) {
      const map = maps.get(`${row.format_config_id}|${row.source}`);
      expect(map?.get(row.player_id)).toBe(row.current_value);
    }
  });

  it("refuses a short read rather than treating the missing rows as zeroes", async () => {
    const rows = makeRows(200, 24);
    const stub = shufflingStub(rows);
    // A client that reports more rows than it will hand over is the shape of
    // every silent truncation. The loader must fail loudly on it.
    const lying = {
      from: () => {
        const b = stub.client.from() as Record<string, unknown>;
        const originalThen = b.then as (r: (v: unknown) => unknown) => Promise<unknown>;
        b.then = (resolve: (v: unknown) => unknown) =>
          originalThen.call(b, (result: unknown) => {
            const r = result as { count: number | null };
            if (r.count !== null) return resolve({ ...r, count: r.count + 1 });
            return resolve(result);
          });
        return b;
      },
    };

    await expect(
      loadPlayerValueMaps(lying as never, Array.from(new Set(rows.map((r) => r.player_id)))),
    ).rejects.toThrow(/incomplete/);
  });
});
