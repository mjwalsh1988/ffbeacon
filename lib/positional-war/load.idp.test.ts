/**
 * The Positional WAR universe read, split by position group (plan IDP-308).
 *
 * Defender rows are filtered at the query through the players join, so an
 * ordinary league's universe never carries them, and the defense slice is read
 * only when the caller says defenders are candidates.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const cacheKeys = vi.hoisted(() => ({ keys: [] as string[][] }));

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown, keyParts: string[]) =>
    async (...args: unknown[]) => {
      cacheKeys.keys.push(keyParts);
      return fn(...args);
    },
}));

let activeClient: SupabaseClient<Database>;
vi.mock("@/lib/supabase/server", () => ({
  createCachedReadClient: () => activeClient,
}));

const { loadWarUniverse } = await import("./load");

type Row = Record<string, unknown>;
type Call = { method: string; args: unknown[] };

function valueAt(row: Row, key: string): unknown {
  if (!key.includes(".")) return row[key];
  let current: unknown = row;
  for (const part of key.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Row)[part];
  }
  return current;
}

/** A minimal PostgREST stand-in: eq, in (with join paths), gt, order, limit, range, count. */
function table(rows: Row[]) {
  return () => {
    const calls: Call[] = [];
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "in", "is", "order", "limit", "gt", "range"]) {
      builder[m] = (...args: unknown[]) => {
        calls.push({ method: m, args });
        return builder;
      };
    }
    builder.then = (onFulfilled: (v: unknown) => unknown) => {
      let out = rows;
      for (const c of calls) {
        const [key, value] = c.args as [string, unknown];
        if (c.method === "eq" || c.method === "is") out = out.filter((r) => valueAt(r, key) === value);
        if (c.method === "gte") out = out.filter((r) => (valueAt(r, key) as number) >= (value as number));
        if (c.method === "lte") out = out.filter((r) => (valueAt(r, key) as number) <= (value as number));
        if (c.method === "gt") out = out.filter((r) => (valueAt(r, key) as string) > (value as string));
        if (c.method === "in") {
          const set = new Set(value as unknown[]);
          out = out.filter((r) => set.has(valueAt(r, key)));
        }
      }
      const select = calls.find((c) => c.method === "select");
      const isCount = Boolean((select?.args[1] as { count?: string } | undefined)?.count);
      if (isCount) return Promise.resolve({ data: [], error: null, count: out.length }).then(onFulfilled);
      const range = calls.find((c) => c.method === "range");
      const page = range ? out.slice(range.args[0] as number, (range.args[1] as number) + 1) : out;
      return Promise.resolve({ data: page, error: null, count: null }).then(onFulfilled);
    };
    return builder;
  };
}

function fakeClient(tables: Record<string, () => unknown>): SupabaseClient<Database> {
  return {
    from: (name: string) => {
      const t = tables[name];
      if (!t) throw new Error(`unexpected table in test: ${name}`);
      return t();
    },
  } as unknown as SupabaseClient<Database>;
}

function projection(id: string, playerId: string, position: string): Row {
  return {
    id,
    player_id: playerId,
    players: { position },
    season: 2026,
    season_type: "regular",
    source: "sleeper",
    week: 5,
    opponent: "BUF",
    stat_line: {},
    projected_pts_ppr: null,
    projected_pts_half_ppr: null,
    projected_pts_std: null,
    availability: "projected",
    injury_status: null,
    updated_at: "2026-08-26T14:00:00.000Z",
  };
}

function player(id: string, position: string, eligible: string[]): Row {
  return {
    id,
    slug: `player-${id}`,
    first_name: "Test",
    last_name: id,
    full_name: `Test ${id}`,
    position,
    eligible_positions: eligible,
    team: "BUF",
    sleeper_id: `s-${id}`,
    injury_status: null,
  };
}

function mixedClient() {
  return fakeClient({
    player_weekly_projections: table([
      projection("1", "p1", "RB"),
      projection("2", "lb1", "LB"),
      projection("3", "dl1", "DL"),
    ]),
    players: table([player("p1", "RB", ["RB"]), player("lb1", "LB", ["LB"]), player("dl1", "DL", ["DL", "LB"])]),
    player_projection_accuracy: table([]),
    nfl_defense_vs_position: table([]),
  });
}

const WINDOW = { season: 2026, fromWeek: 5, toWeek: 5, scoringBase: "pts_ppr", source: "sleeper" } as const;

beforeEach(() => {
  cacheKeys.keys = [];
});

describe("position-group slices (plan IDP-308)", () => {
  it("with defenders left out, filters them at the query and reads only the offense slice", async () => {
    activeClient = mixedClient();
    const universe = await loadWarUniverse({ ...WINDOW });
    expect(universe.projections.map((r) => r.playerId)).toEqual(["p1"]);
    const weekKeys = cacheKeys.keys.filter((k) => k[0] === "positional-war-projection-week");
    expect(weekKeys.map((k) => k[3])).toEqual(["offense"]);
    expect(universe.players.get("p1")?.eligible).toBeUndefined();
  });

  it("with defenders in, reads both slices, keeps eligibility and reads idp123 beside the base", async () => {
    activeClient = mixedClient();
    const universe = await loadWarUniverse({ ...WINDOW, includeDefenders: true });
    expect(universe.projections.map((r) => r.playerId).sort()).toEqual(["dl1", "lb1", "p1"]);
    const weekKeys = cacheKeys.keys.filter((k) => k[0] === "positional-war-projection-week");
    expect(weekKeys.map((k) => k[3]).sort()).toEqual(["defense", "offense"]);
    expect(universe.players.get("dl1")?.eligible).toEqual(["DL", "LB"]);
    const accuracyKey = cacheKeys.keys.find((k) => k[0] === "positional-war-accuracy")!;
    expect(accuracyKey).toContain("pts_ppr+idp123");
    const playersKey = cacheKeys.keys.find((k) => k[0] === "positional-war-players")!;
    expect(playersKey).toContain("with-defense");
  });
});
