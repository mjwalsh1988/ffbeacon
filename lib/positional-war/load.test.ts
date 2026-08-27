/**
 * Tests for the cached full-universe projection read.
 *
 * The Supabase client is faked the way lib/power-pulse/load.test.ts fakes it:
 * a minimal object satisfying the exact call chain the code under test makes.
 * Here that chain varies by table and by whether the caller wants a count or a
 * page of rows, so the fake is a small generic query engine over an in-memory
 * row array rather than one fixed builder: it applies the same eq/gte/lte/
 * in/is/gt filters PostgREST would, then either reports a count (when select()
 * was called with { count, head: true }) or an ordered, limited page. That one
 * engine is enough to serve loadWindowProjections' count-plus-page walk, the
 * players/accuracy/defense reads, and loadProjectionsSnapshot's order-by-
 * updated_at-desc-limit-1 query, without a special case per query shape.
 *
 * next/cache's unstable_cache is mocked to a pass-through (matching
 * lib/signal-scout/leaderboards.test.ts): outside a real Next.js request
 * context it does not behave like a cache anyway, so tests exercise the real
 * query path on every call.
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PowerPulseSettings } from "@/lib/power-pulse/default-settings";
import { DEFAULT_POWER_PULSE_SETTINGS } from "@/lib/power-pulse/default-settings";
import * as projectModule from "@/lib/power-pulse/project";
import { DB_CHUNK_CONCURRENCY } from "@/lib/power-pulse/load";
import type { ScoringSettings } from "@/lib/league-scoring";
import type { WarUniverse, WarUniversePlayer } from "./load";

// vi.mock calls are hoisted by Vitest above every import in this file, so it
// does not matter that the static "./load" import below is written first.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

let activeClient: SupabaseClient<Database>;
vi.mock("@/lib/supabase/server", () => ({
  createCachedReadClient: () => activeClient,
}));

const {
  loadWarUniverse,
  loadWarUniverseUncached,
  loadProjectionsSnapshot,
  truncateToHour,
  buildWarPlayers,
} = await import("./load");

type Row = Record<string, unknown>;
type Call = { method: string; args: unknown[] };

/** A thenable that resolves once, applying `resolve` to the recorded calls. */
function makeBuilder(resolve: (calls: Call[]) => { data: unknown; error: unknown; count?: number | null }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const chain =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  for (const m of ["select", "eq", "gte", "lte", "in", "is", "order", "limit", "gt"]) {
    builder[m] = chain(m);
  }
  builder.then = (
    onFulfilled: (value: { data: unknown; error: unknown; count?: number | null }) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve().then(() => resolve(calls)).then(onFulfilled, onRejected);
  return builder;
}

function isCountQuery(calls: Call[]): boolean {
  const select = calls.find((c) => c.method === "select");
  const opts = select?.args[1] as { count?: string; head?: boolean } | undefined;
  return Boolean(opts?.count);
}

function applyFilters(rows: Row[], calls: Call[]): Row[] {
  let out = rows;
  for (const c of calls) {
    if (c.method === "eq") {
      const [key, value] = c.args as [string, unknown];
      out = out.filter((r) => r[key] === value);
    } else if (c.method === "gte") {
      const [key, value] = c.args as [string, number];
      out = out.filter((r) => (r[key] as number) >= value);
    } else if (c.method === "lte") {
      const [key, value] = c.args as [string, number];
      out = out.filter((r) => (r[key] as number) <= value);
    } else if (c.method === "gt") {
      const [key, value] = c.args as [string, string];
      out = out.filter((r) => (r[key] as string) > value);
    } else if (c.method === "in") {
      const [key, values] = c.args as [string, unknown[]];
      const set = new Set(values);
      out = out.filter((r) => set.has(r[key]));
    } else if (c.method === "is") {
      const [key, value] = c.args as [string, unknown];
      out = out.filter((r) => r[key] === value);
    }
  }
  return out;
}

function applyOrderAndLimit(rows: Row[], calls: Call[]): Row[] {
  let out = [...rows];
  const orderCall = calls.find((c) => c.method === "order");
  if (orderCall) {
    const [key, opts] = orderCall.args as [string, { ascending?: boolean } | undefined];
    const asc = opts?.ascending !== false;
    out.sort((a, b) => {
      const av = a[key] as string | number;
      const bv = b[key] as string | number;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return asc ? cmp : -cmp;
    });
  }
  const limitCall = calls.find((c) => c.method === "limit");
  if (limitCall) {
    const [n] = limitCall.args as [number];
    out = out.slice(0, n);
  }
  return out;
}

/** One table backed by a plain row array, answering both count and page shapes. */
function table(rows: Row[]) {
  return () =>
    makeBuilder((calls) => {
      const filtered = applyFilters(rows, calls);
      if (isCountQuery(calls)) {
        return { data: [], error: null, count: filtered.length };
      }
      return { data: applyOrderAndLimit(filtered, calls), error: null, count: null };
    });
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

function projectionRow(id: string, playerId: string, week: number, ppr: number, updatedAt: string): Row {
  return {
    id,
    player_id: playerId,
    season: 2026,
    season_type: "regular",
    week,
    opponent: "BUF",
    stat_line: { rec: 5, rec_yd: 60 },
    projected_pts_ppr: ppr,
    projected_pts_half_ppr: ppr * 0.9,
    projected_pts_std: ppr * 0.8,
    availability: "projected",
    injury_status: null,
    updated_at: updatedAt,
  };
}

/**
 * One `players` row as PLAYER_COLUMNS returns it.
 *
 * The resolver asks Postgres to extract the two jsonb fields it wants
 * (`external_ids->>sleeper` and `metadata->sleeper->>injury_status`) rather
 * than shipping both whole columns to read one string out of each, so what
 * comes back is already flat text, aliased. This fixture carries that shape
 * and not the raw jsonb, because a fixture that hands the code a column the
 * query never selected would let a regression pass here and fail in
 * production.
 */
function playerRow(
  id: string,
  position: string,
  sleeperId: string,
  injuryStatus: string | null = null,
): Row {
  return {
    id,
    slug: `player-${id}`,
    first_name: "Test",
    last_name: id,
    full_name: `Test ${id}`,
    position,
    team: "BUF",
    sleeper_id: sleeperId,
    injury_status: injuryStatus,
  };
}

describe("truncateToHour", () => {
  it("zeroes minutes, seconds and milliseconds", () => {
    expect(truncateToHour("2026-08-26T14:37:22.123Z")).toBe("2026-08-26T14:00:00.000Z");
  });
});

describe("loadProjectionsSnapshot", () => {
  it("returns null when there are no rows", async () => {
    activeClient = fakeClient({ player_weekly_projections: table([]) });
    const result = await loadProjectionsSnapshot({ season: 2026, fromWeek: 5 });
    expect(result).toBeNull();
  });

  it("returns the max updated_at truncated to the hour", async () => {
    activeClient = fakeClient({
      player_weekly_projections: table([
        projectionRow("1", "p1", 5, 12, "2026-08-26T14:37:22.123Z"),
        projectionRow("2", "p1", 6, 13, "2026-08-26T16:05:00.000Z"),
      ]),
    });
    const result = await loadProjectionsSnapshot({ season: 2026, fromWeek: 5 });
    expect(result).toBe("2026-08-26T16:00:00.000Z");
  });
});

describe("loadWarUniverseUncached: the count guard", () => {
  it("throws when the paged read comes back short of the counted total", async () => {
    // Five rows exist by count, but the page handler only ever hands back
    // three, then stops because a short page ends the keyset loop. That is
    // exactly what a dropped-rows bug looks like from the caller's side, and
    // the guard must turn it into a thrown error rather than a silently
    // shrunk universe.
    activeClient = fakeClient({
      player_weekly_projections: () =>
        makeBuilder((calls) => {
          if (isCountQuery(calls)) return { data: [], error: null, count: 5 };
          return {
            data: [
              projectionRow("1", "p1", 5, 10, "2026-08-26T14:00:00.000Z"),
              projectionRow("2", "p2", 5, 11, "2026-08-26T14:00:00.000Z"),
              projectionRow("3", "p3", 5, 12, "2026-08-26T14:00:00.000Z"),
            ],
            error: null,
            count: null,
          };
        }),
    });

    await expect(
      loadWarUniverseUncached({ season: 2026, fromWeek: 5, toWeek: 5, scoringBase: "pts_ppr" }),
    ).rejects.toThrow(/incomplete/);
  });
});

describe("loadWarUniverse: the serialization round trip", () => {
  it("survives JSON.parse(JSON.stringify(x)) and rebuilds non-empty Maps", async () => {
    activeClient = fakeClient({
      player_weekly_projections: table([
        projectionRow("1", "p1", 5, 15, "2026-08-26T14:00:00.000Z"),
        projectionRow("2", "p1", 6, 16, "2026-08-26T14:00:00.000Z"),
      ]),
      players: table([playerRow("p1", "RB", "1001")]),
      player_projection_accuracy: table([
        {
          player_id: "p1",
          scoring: "pts_ppr",
          season: null,
          shrunk_multiplier: 1.05,
          beat_rate: 0.6,
          availability_rate: 0.9,
          ratio_stdev: 0.3,
          weeks_played: 12,
        },
      ]),
      nfl_defense_vs_position: table([
        {
          team: "BUF",
          season: 2025,
          scoring: "pts_ppr",
          position: "RB",
          multiplier: 1.1,
          games_sampled: 17,
        },
      ]),
    });

    // What actually gets handed to unstable_cache's underlying storage.
    const serialized = await loadWarUniverseUncached({
      season: 2026,
      fromWeek: 5,
      toWeek: 6,
      scoringBase: "pts_ppr",
    });

    const roundTripped = JSON.parse(JSON.stringify(serialized));
    expect(roundTripped).toEqual(serialized);

    const rebuilt: WarUniverse = {
      players: new Map(roundTripped.players),
      projections: roundTripped.projections,
      accuracy: new Map(roundTripped.accuracy),
      defense: new Map(roundTripped.defense),
      defenseSeasons: roundTripped.defenseSeasons,
    };
    expect(rebuilt.players.size).toBeGreaterThan(0);
    expect(rebuilt.accuracy.size).toBeGreaterThan(0);
    expect(rebuilt.defense.size).toBeGreaterThan(0);
    expect(rebuilt.projections.length).toBeGreaterThan(0);

    // And loadWarUniverse itself, with the mocked pass-through cache, hands
    // back real Maps built the same way.
    const universe = await loadWarUniverse({
      season: 2026,
      fromWeek: 5,
      toWeek: 6,
      scoringBase: "pts_ppr",
    });
    expect(universe.players.get("p1")?.slug).toBe("player-p1");
    expect(universe.players instanceof Map).toBe(true);
  });
});

describe("concurrency: independent chunk reads overlap in flight", () => {
  it("resolveUniversePlayers' player-resolve chunks run concurrently, bounded by the cap", async () => {
    // Must match PLAYER_RESOLVE_CHUNK in lib/positional-war/load.ts.
    const RESOLVE_CHUNK = 200;
    const CHUNK_COUNT = 6;
    const playerIds = Array.from({ length: RESOLVE_CHUNK * CHUNK_COUNT }, (_, i) => `p${i}`);

    const projectionRows = playerIds.map((id, i) =>
      projectionRow(String(i + 1), id, 5, 10, "2026-08-26T14:00:00.000Z"),
    );
    const playerRows = playerIds.map((id) => playerRow(id, "RB", `s-${id}`));

    let inFlight = 0;
    let maxInFlight = 0;

    // A players-table fake that actually yields (setTimeout, not a plain
    // microtask), so overlapping in-flight chunk reads are observable rather
    // than resolving too fast to ever be seen "at the same time".
    function concurrencyTrackingPlayersTable() {
      const calls: Call[] = [];
      const builder: Record<string, unknown> = {};
      const chain =
        (method: string) =>
        (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      for (const m of ["select", "eq", "gte", "lte", "in", "is", "order", "limit", "gt"]) {
        builder[m] = chain(m);
      }
      builder.then = (
        onFulfilled: (v: { data: unknown; error: unknown; count?: number | null }) => unknown,
        onRejected?: (r: unknown) => unknown,
      ) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise<void>((resolve) => setTimeout(resolve, 5))
          .then(() => {
            const filtered = applyFilters(playerRows, calls);
            inFlight--;
            return { data: filtered, error: null, count: null };
          })
          .then(onFulfilled, onRejected);
      };
      return builder;
    }

    activeClient = fakeClient({
      player_weekly_projections: table(projectionRows),
      players: concurrencyTrackingPlayersTable,
      player_projection_accuracy: table([]),
      nfl_defense_vs_position: table([]),
    });

    await loadWarUniverseUncached({ season: 2026, fromWeek: 5, toWeek: 5, scoringBase: "pts_ppr" });

    // Six chunks exist (1200 ids at width 200), so a genuinely concurrent
    // run overlaps more than one at a time, and the cap holds it at or below
    // DB_CHUNK_CONCURRENCY even though six could theoretically all fire.
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(DB_CHUNK_CONCURRENCY);
  });
});

describe("buildWarPlayers", () => {
  const settings: PowerPulseSettings = DEFAULT_POWER_PULSE_SETTINGS;
  const scoringSettings: ScoringSettings = { rec: 1, rec_yd: 0.1, pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec_td: 6 };

  function universeOf(players: WarUniversePlayer[], projections: WarUniverse["projections"]): WarUniverse {
    return {
      players: new Map(players.map((p) => [p.playerId, p])),
      projections,
      accuracy: new Map(),
      defense: new Map(),
      defenseSeasons: [2025, 2024],
    };
  }

  it("omits a week whose projectPlayerWeek returns null rather than storing a zero", () => {
    const player: WarUniversePlayer = {
      playerId: "p1",
      sleeperId: "1001",
      slug: "player-p1",
      name: "Test P1",
      team: "BUF",
      position: "RB",
      injuryStatus: null,
    };
    // Week 6 is a bye: no projection row at all for that week.
    const universe = universeOf(
      [player],
      [
        {
          playerId: "p1",
          week: 5,
          opponent: "MIA",
          statLine: { rec: 5, rec_yd: 60, rush_yd: 20 },
          ppr: 18,
          halfPpr: 15,
          std: 12,
          availability: "projected",
          injuryStatus: null,
        },
      ],
    );

    const result = buildWarPlayers({
      universe,
      scoringSettings,
      settings,
      weeks: [5, 6],
      currentWeek: 5,
    });

    expect(result).toHaveLength(1);
    const byWeek = result[0].byWeek;
    expect(byWeek.has(5)).toBe(true);
    expect(byWeek.has(6)).toBe(false);
  });

  it("excludes a player with zero projectable weeks entirely", () => {
    const player: WarUniversePlayer = {
      playerId: "p2",
      sleeperId: "1002",
      slug: "player-p2",
      name: "Test P2",
      team: "MIA",
      position: "WR",
      injuryStatus: null,
    };
    // No projection rows for this player at all.
    const universe = universeOf([player], []);

    const result = buildWarPlayers({
      universe,
      scoringSettings,
      settings,
      weeks: [5, 6, 7],
      currentWeek: 5,
    });

    expect(result).toHaveLength(0);
  });

  it("computes reliability once per player, not once per player per week", () => {
    const spy = vi.spyOn(projectModule, "reliabilityMultiplier");
    const player: WarUniversePlayer = {
      playerId: "p3",
      sleeperId: "1003",
      slug: "player-p3",
      name: "Test P3",
      team: "BUF",
      position: "TE",
      injuryStatus: null,
    };
    const universe: WarUniverse = {
      players: new Map([["p3", player]]),
      projections: [5, 6, 7].map((week) => ({
        playerId: "p3",
        week,
        opponent: "NYJ",
        statLine: { rec: 4, rec_yd: 40 },
        ppr: 10,
        halfPpr: 8,
        std: 6,
        availability: "projected",
        injuryStatus: null,
      })),
      accuracy: new Map([
        [
          "p3",
          {
            playerId: "p3",
            shrunkMultiplier: 1.1,
            beatRate: 0.55,
            availabilityRate: 0.95,
            ratioStdev: 0.4,
            weeksPlayed: 10,
          },
        ],
      ]),
      defense: new Map(),
      defenseSeasons: [2025, 2024],
    };

    spy.mockClear();
    buildWarPlayers({ universe, scoringSettings, settings, weeks: [5, 6, 7], currentWeek: 5 });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("produces points equal to a hand-computed value using reliability applied exactly once", () => {
    const player: WarUniversePlayer = {
      playerId: "p4",
      sleeperId: "1004",
      slug: "player-p4",
      name: "Test P4",
      team: "BUF",
      position: "RB",
      injuryStatus: null,
    };
    const universe: WarUniverse = {
      players: new Map([["p4", player]]),
      projections: [
        {
          playerId: "p4",
          week: 5,
          opponent: null,
          statLine: { rush_yd: 100, rush_td: 1 },
          ppr: 16,
          halfPpr: 16,
          std: 16,
          availability: "projected",
          injuryStatus: null,
        },
      ],
      accuracy: new Map([
        [
          "p4",
          {
            playerId: "p4",
            shrunkMultiplier: 1.1,
            beatRate: 0.5,
            availabilityRate: 1,
            ratioStdev: 0.4,
            weeksPlayed: 12,
          },
        ],
      ]),
      defense: new Map(),
      defenseSeasons: [2025, 2024],
    };

    const [result] = buildWarPlayers({
      universe,
      scoringSettings,
      settings,
      weeks: [5],
      currentWeek: 5,
    });

    // rush_yd 100 * 0.1 + rush_td 1 * 6 = 16, times reliability 1.1 applied
    // exactly once (opponent, availability and injury are all neutral here).
    expect(result.byWeek.get(5)?.points).toBeCloseTo(16 * 1.1, 5);
  });
});

/* ---------------------------------------------------------------------- */
/* One scan, not two                                                       */
/* ---------------------------------------------------------------------- */

describe("loadWarUniverseUncached: one pass over the window", () => {
  it("reads the projection window once and derives the player set from it", async () => {
    // Two players, three rows across two weeks. The universe is defined as
    // "everyone with a projection in the window", so the rows the engine needs
    // and the rows that tell us who exists are the same rows; reading them
    // twice bought nothing. This asserts the second read is gone, by counting
    // how many non-count reads the projections table serves.
    let projectionReads = 0;
    const rows = [
      projectionRow("1", "p1", 5, 15, "2026-08-26T14:00:00.000Z"),
      projectionRow("2", "p2", 5, 12, "2026-08-26T14:00:00.000Z"),
      projectionRow("3", "p1", 6, 16, "2026-08-26T14:00:00.000Z"),
    ];
    activeClient = fakeClient({
      player_weekly_projections: () =>
        makeBuilder((calls) => {
          const filtered = applyFilters(rows, calls);
          if (isCountQuery(calls)) return { data: [], error: null, count: filtered.length };
          projectionReads += 1;
          return { data: applyOrderAndLimit(filtered, calls), error: null, count: null };
        }),
      players: table([playerRow("p1", "RB", "1001"), playerRow("p2", "WR", "1002")]),
      player_projection_accuracy: table([]),
      nfl_defense_vs_position: table([]),
    });

    const universe = await loadWarUniverseUncached({
      season: 2026,
      fromWeek: 5,
      toWeek: 6,
      scoringBase: "pts_ppr",
    });

    // One read per week in the window, and no second pass for the full rows.
    expect(projectionReads).toBe(2);
    expect(universe.projections).toHaveLength(3);
    expect(universe.players.map(([id]) => id).sort()).toEqual(["p1", "p2"]);
  });

  it("keeps only the rows whose player resolved to a projectable position", async () => {
    // A projection row exists for a player the resolver drops (a position
    // Sleeper does not project). The row must not reach the engine: it has no
    // position to be scored under, and a stray row would land in a curve.
    activeClient = fakeClient({
      player_weekly_projections: table([
        projectionRow("1", "p1", 5, 15, "2026-08-26T14:00:00.000Z"),
        projectionRow("2", "idp1", 5, 9, "2026-08-26T14:00:00.000Z"),
      ]),
      players: table([playerRow("p1", "RB", "1001"), playerRow("idp1", "LB", "1003")]),
      player_projection_accuracy: table([]),
      nfl_defense_vs_position: table([]),
    });

    const universe = await loadWarUniverseUncached({
      season: 2026,
      fromWeek: 5,
      toWeek: 5,
      scoringBase: "pts_ppr",
    });

    expect(universe.players.map(([id]) => id)).toEqual(["p1"]);
    expect(universe.projections.map((r) => r.playerId)).toEqual(["p1"]);
  });

  it("carries the extracted injury designation onto the universe player", async () => {
    activeClient = fakeClient({
      player_weekly_projections: table([
        projectionRow("1", "p1", 5, 15, "2026-08-26T14:00:00.000Z"),
      ]),
      players: table([playerRow("p1", "RB", "1001", "IR")]),
      player_projection_accuracy: table([]),
      nfl_defense_vs_position: table([]),
    });

    const universe = await loadWarUniverseUncached({
      season: 2026,
      fromWeek: 5,
      toWeek: 5,
      scoringBase: "pts_ppr",
    });

    expect(universe.players[0][1].injuryStatus).toBe("IR");
    expect(universe.players[0][1].sleeperId).toBe("1001");
  });

  it("treats an empty extracted string as no designation, not as a designation", async () => {
    activeClient = fakeClient({
      player_weekly_projections: table([
        projectionRow("1", "p1", 5, 15, "2026-08-26T14:00:00.000Z"),
      ]),
      players: table([playerRow("p1", "RB", "1001", "")]),
      player_projection_accuracy: table([]),
      nfl_defense_vs_position: table([]),
    });

    const universe = await loadWarUniverseUncached({
      season: 2026,
      fromWeek: 5,
      toWeek: 5,
      scoringBase: "pts_ppr",
    });

    expect(universe.players[0][1].injuryStatus).toBeNull();
  });
});
