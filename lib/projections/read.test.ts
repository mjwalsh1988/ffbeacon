/**
 * Coverage for lib/projections/read.ts loadAdjustedProjections, THE single
 * adjusted read path every consumer of player_weekly_projections is meant to
 * go through.
 *
 * The fake client below is a generic row-filtering stand-in for four tables
 * (player_weekly_projections, player_projection_accuracy,
 * nfl_defense_vs_position, league_power_pulse_settings), matching the house
 * pattern in lib/sync-nfl-odds.test.ts and lib/power-pulse/load.test.ts: the
 * smallest fake that satisfies the real call chain, cast to SupabaseClient
 * afterward.
 */

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadAdjustedProjections } from "./read";
import { SLEEPER_SOURCE, BEACON_SOURCE } from "./source";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

type FilterState = {
  eq: Record<string, unknown>;
  gte: Record<string, unknown>;
  lte: Record<string, unknown>;
  gt: Record<string, unknown>;
  in: Record<string, unknown[]>;
  is: Record<string, unknown>;
  limit?: number;
  head?: boolean;
  maybeSingle?: boolean;
};

function emptyState(): FilterState {
  return { eq: {}, gte: {}, lte: {}, gt: {}, in: {}, is: {} };
}

/**
 * One query builder instance per `.from(table)` call, with its OWN filter
 * state. Sharing state across calls (e.g. one template object reused via
 * spread) would leak one query's filters into an unrelated one, which is
 * exactly wrong for a function like availableProjectionSources that fires
 * two concurrent probes against the same table.
 */
/**
 * `headProbes` is optional instrumentation: when passed, every `.select(...,
 * { head: true })` query (the shape availableProjectionSources's count
 * probes use) records the table it queried. Existing callers that omit it are
 * unaffected.
 */
function makeBuilder(table: string, tables: Tables, headProbes?: string[]) {
  const state = emptyState();

  function rowsFor(): Row[] {
    let rows = tables[table] ?? [];
    for (const [col, val] of Object.entries(state.eq)) {
      rows = rows.filter((r) => r[col] === val);
    }
    for (const [col, val] of Object.entries(state.gte)) {
      rows = rows.filter((r) => Number(r[col]) >= Number(val));
    }
    for (const [col, val] of Object.entries(state.lte)) {
      rows = rows.filter((r) => Number(r[col]) <= Number(val));
    }
    for (const [col, val] of Object.entries(state.gt)) {
      rows = rows.filter((r) => String(r[col]) > String(val));
    }
    for (const [col, vals] of Object.entries(state.in)) {
      const set = new Set(vals);
      rows = rows.filter((r) => set.has(r[col]));
    }
    for (const [col, val] of Object.entries(state.is)) {
      rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val));
    }
    rows = [...rows].sort((a, b) =>
      String(a.id ?? "").localeCompare(String(b.id ?? "")),
    );
    if (state.limit !== undefined) rows = rows.slice(0, state.limit);
    return rows;
  }

  const builder = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.head) {
        state.head = true;
        headProbes?.push(table);
      }
      return builder;
    },
    eq(col: string, val: unknown) {
      state.eq[col] = val;
      return builder;
    },
    gte(col: string, val: unknown) {
      state.gte[col] = val;
      return builder;
    },
    lte(col: string, val: unknown) {
      state.lte[col] = val;
      return builder;
    },
    gt(col: string, val: unknown) {
      state.gt[col] = val;
      return builder;
    },
    in(col: string, vals: unknown[]) {
      state.in[col] = vals;
      return builder;
    },
    is(col: string, val: unknown) {
      state.is[col] = val;
      return builder;
    },
    order() {
      return builder;
    },
    limit(n: number) {
      state.limit = n;
      return builder;
    },
    maybeSingle() {
      state.maybeSingle = true;
      return builder;
    },
    then(
      resolve: (v: { data: unknown; count?: number; error: null }) => void,
      _reject?: (e: unknown) => void,
    ) {
      const rows = rowsFor();
      if (state.head) {
        resolve({ data: null, count: rows.length, error: null });
      } else if (state.maybeSingle) {
        resolve({ data: rows[0] ?? null, error: null });
      } else {
        resolve({ data: rows, error: null });
      }
    },
  };
  return builder;
}

function fakeClient(tables: Tables, headProbes?: string[]): SupabaseClient<Database> {
  return {
    from: (table: string) => makeBuilder(table, tables, headProbes),
  } as unknown as SupabaseClient<Database>;
}

/** A player_weekly_projections row, with sensible defaults for the columns tests don't care about. */
function projectionRow(overrides: Partial<Row> & { id: string; player_id: string; week: number }): Row {
  return {
    season: 2026,
    season_type: "regular",
    source: SLEEPER_SOURCE,
    opponent: null,
    stat_line: null,
    projected_pts_ppr: null,
    projected_pts_half_ppr: null,
    projected_pts_std: null,
    availability: null,
    injury_status: null,
    ...overrides,
  };
}

// isUsableScoring (lib/league-scoring.ts) requires at least one yardage key
// AND one touchdown key present as a number before scoreStatMap will trust a
// dot product over the exact fallback; td keys are present here purely to
// clear that bar; every test's stat lines omit them, so they never actually
// contribute (a missing key scores as 0).
const PPR_SCORING = {
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  rush_att: 0,
  rush_yd: 0.1,
  rush_td: 6,
};

describe("loadAdjustedProjections", () => {
  it("returns absent for a player with no rows at all, never a zero", async () => {
    const client = fakeClient({
      player_weekly_projections: [
        projectionRow({
          id: "r1",
          player_id: "p4",
          week: 1,
          stat_line: { rush_att: 10, rush_yd: 50 },
        }),
      ],
    });

    const { byPlayer } = await loadAdjustedProjections({
      supabase: client,
      playerIds: ["p4", "p5"],
      season: 2026,
      fromWeek: 1,
      toWeek: 3,
      scoringSettings: PPR_SCORING,
      positionByPlayer: new Map([
        ["p4", "RB"],
        ["p5", "QB"],
      ]),
      currentWeek: 1,
    });

    expect(byPlayer.has("p5")).toBe(false);
    expect(byPlayer.has("p4")).toBe(true);
  });

  it("excludes a week whose row cannot be scored, but keeps the weeks that can", async () => {
    const client = fakeClient({
      player_weekly_projections: [
        projectionRow({
          id: "r1",
          player_id: "p3",
          week: 1,
          stat_line: { rec: 6, rec_yd: 60 },
        }),
        // Present, but nothing scoreable in it: no stat line and no stored
        // fallback total either. projectPlayerWeek must read this as an
        // ABSENT week, not a zero.
        projectionRow({ id: "r2", player_id: "p3", week: 2 }),
        // Week 3 has no row at all (a bye): never enters byPlayerWeek.
      ],
    });

    const { byPlayer } = await loadAdjustedProjections({
      supabase: client,
      playerIds: ["p3"],
      season: 2026,
      fromWeek: 1,
      toWeek: 3,
      scoringSettings: PPR_SCORING,
      positionByPlayer: new Map([["p3", "TE"]]),
      currentWeek: 1,
    });

    const summary = byPlayer.get("p3");
    expect(summary).toBeDefined();
    expect(summary!.byWeek.has(1)).toBe(true);
    expect(summary!.byWeek.has(2)).toBe(false);
    expect(summary!.byWeek.has(3)).toBe(false);
    expect(summary!.weeks).toBe(1);
    // rec 6 * 1 + rec_yd 60 * 0.1 = 12, no other multiplier moves it: no
    // opponent (opponent null), no accuracy row, no injury.
    expect(summary!.total).toBeCloseTo(12, 6);
    expect(summary!.perWeek).toBeCloseTo(12, 6);
  });

  it("counts a stored 'out' zero as a real week rather than excluding it", async () => {
    const client = fakeClient({
      player_weekly_projections: [
        projectionRow({
          id: "r1",
          player_id: "p2",
          week: 2,
          availability: "out",
          // Sleeper published nothing for an "out" week; the short circuit in
          // projectPlayerWeek fires before any stat line would be read.
          stat_line: null,
        }),
      ],
    });

    const { byPlayer } = await loadAdjustedProjections({
      supabase: client,
      playerIds: ["p2"],
      season: 2026,
      fromWeek: 1,
      toWeek: 3,
      scoringSettings: PPR_SCORING,
      positionByPlayer: new Map([["p2", "WR"]]),
      currentWeek: 2,
    });

    const summary = byPlayer.get("p2");
    expect(summary).toBeDefined();
    expect(summary!.weeks).toBe(1);
    expect(summary!.total).toBe(0);
    expect(summary!.perWeek).toBe(0);
    const week2 = summary!.byWeek.get(2);
    expect(week2).toBeDefined();
    expect(week2!.points).toBe(0);
    expect(week2!.rawPoints).toBe(0);
  });

  it("averages perWeek over the weeks that actually carried a projection, not the window length", async () => {
    const client = fakeClient({
      player_weekly_projections: [
        projectionRow({
          id: "r1",
          player_id: "p4",
          week: 1,
          stat_line: { rush_att: 10, rush_yd: 50 }, // 0*10 + 0.1*50 = 5
        }),
        projectionRow({
          id: "r2",
          player_id: "p4",
          week: 2,
          stat_line: { rush_att: 5, rush_yd: 100 }, // 0*5 + 0.1*100 = 10
        }),
        // Week 3: no row, a bye inside the window.
      ],
    });

    const { byPlayer } = await loadAdjustedProjections({
      supabase: client,
      playerIds: ["p4"],
      season: 2026,
      fromWeek: 1,
      toWeek: 3,
      scoringSettings: PPR_SCORING,
      positionByPlayer: new Map([["p4", "RB"]]),
      currentWeek: 1,
    });

    const summary = byPlayer.get("p4")!;
    expect(summary.weeks).toBe(2);
    expect(summary.total).toBeCloseTo(15, 6);
    // NOT total / 3 (the window length). A bye must not drag the average down.
    expect(summary.perWeek).toBeCloseTo(7.5, 6);
  });

  it("resolves the source before querying, and only the resolved source's rows are read", async () => {
    const client = fakeClient({
      league_power_pulse_settings: [
        { id: "global", settings: { beaconProjections: { enabled: true } } },
      ],
      player_weekly_projections: [
        projectionRow({
          id: "r1",
          player_id: "p1",
          week: 10,
          source: SLEEPER_SOURCE,
          stat_line: { rush_att: 100, rush_yd: 0 }, // sleeper: 10 pts
        }),
        projectionRow({
          id: "r2",
          player_id: "p1",
          week: 10,
          source: BEACON_SOURCE,
          stat_line: { rush_att: 10, rush_yd: 0 }, // ffbeacon: 1 pt
        }),
      ],
    });

    const result = await loadAdjustedProjections({
      supabase: client,
      playerIds: ["p1"],
      season: 2026,
      fromWeek: 10,
      toWeek: 10,
      scoringSettings: { rush_att: 0.1, rush_yd: 0, rush_td: 6 },
      positionByPlayer: new Map([["p1", "RB"]]),
      currentWeek: 10,
    });

    expect(result.source).toBe(BEACON_SOURCE);
    const summary = result.byPlayer.get("p1")!;
    expect(summary.weeks).toBe(1);
    // The ffbeacon row (1 pt), never the sleeper row (10 pts): the source
    // resolution actually fed the projections query rather than being
    // computed and then ignored.
    expect(summary.byWeek.get(10)!.rawPoints).toBeCloseTo(1, 6);
  });

  it("falls back to SLEEPER_SOURCE when the feature is off, regardless of what rows exist", async () => {
    const client = fakeClient({
      league_power_pulse_settings: [
        { id: "global", settings: { beaconProjections: { enabled: false } } },
      ],
      player_weekly_projections: [
        projectionRow({
          id: "r1",
          player_id: "p1",
          week: 10,
          source: SLEEPER_SOURCE,
          stat_line: { rush_att: 100, rush_yd: 0 },
        }),
        projectionRow({
          id: "r2",
          player_id: "p1",
          week: 10,
          source: BEACON_SOURCE,
          stat_line: { rush_att: 10, rush_yd: 0 },
        }),
      ],
    });

    const result = await loadAdjustedProjections({
      supabase: client,
      playerIds: ["p1"],
      season: 2026,
      fromWeek: 10,
      toWeek: 10,
      scoringSettings: { rush_att: 0.1, rush_yd: 0, rush_td: 6 },
      positionByPlayer: new Map([["p1", "RB"]]),
      currentWeek: 10,
    });

    expect(result.source).toBe(SLEEPER_SOURCE);
    expect(result.byPlayer.get("p1")!.byWeek.get(10)!.rawPoints).toBeCloseTo(10, 6);
  });

  it("applies the opponent-strength and injury multipliers, so adjusted points differ from raw", async () => {
    const client = fakeClient({
      nfl_defense_vs_position: [
        {
          team: "DAL",
          season: 2026,
          position: "RB",
          scoring: "pts_ppr",
          multiplier: 1.3,
          adjusted_multiplier: 1.2,
          shrunk_multiplier: 1.2,
          games_sampled: 10,
        },
      ],
      player_weekly_projections: [
        projectionRow({
          id: "r1",
          player_id: "p1",
          week: 5,
          opponent: "DAL",
          // Not "projected", so Sleeper has not priced an injury designation
          // into this number and our own week-to-week discount is free to fire.
          availability: "unprojected",
          stat_line: { rec: 5, rec_yd: 50, rush_att: 10, rush_yd: 40 },
        }),
      ],
    });

    const result = await loadAdjustedProjections({
      supabase: client,
      playerIds: ["p1"],
      season: 2026,
      fromWeek: 5,
      toWeek: 5,
      scoringSettings: PPR_SCORING,
      positionByPlayer: new Map([["p1", "RB"]]),
      injuryByPlayer: new Map([["p1", "QUESTIONABLE"]]),
      currentWeek: 5,
    });

    const week5 = result.byPlayer.get("p1")!.byWeek.get(5)!;
    // rec 5*1 + rec_yd 50*0.1 + rush_att 10*0 + rush_yd 40*0.1 = 5+5+0+4 = 14.
    expect(week5.rawPoints).toBeCloseTo(14, 6);
    // Opponent multiplier: shrunk 1.2, clamped to the default [0.85, 1.15]
    // ceiling of 1.15. Injury multiplier: QUESTIONABLE at the current week,
    // 0.9. 14 * 1.15 * 0.9 = 14.49, not 14.
    expect(week5.points).toBeCloseTo(14.49, 6);
    expect(week5.points).not.toBeCloseTo(week5.rawPoints, 6);
  });

  // FINDING 1 regression guard. Before loadAccuracy took a `source` parameter,
  // it read player_projection_accuracy with no source filter at all, so once a
  // source='ffbeacon' blended row existed alongside source='sleeper' for the
  // same player, PostgREST could return both with no ORDER BY and whichever
  // came back last silently won: a multiplier measured against one source's
  // projection applied to the other's number.
  it("applies the reliability multiplier measured against the resolved source, never the other one", async () => {
    const stat_line = { rush_att: 10, rush_yd: 100 };
    const client = fakeClient({
      league_power_pulse_settings: [
        { id: "global", settings: { beaconProjections: { enabled: true } } },
      ],
      player_weekly_projections: [
        projectionRow({ id: "r1", player_id: "p1", week: 10, source: SLEEPER_SOURCE, stat_line }),
        projectionRow({ id: "r2", player_id: "p1", week: 10, source: BEACON_SOURCE, stat_line }),
      ],
      player_projection_accuracy: [
        {
          player_id: "p1",
          scoring: "pts_ppr",
          season: null,
          source: SLEEPER_SOURCE,
          shrunk_multiplier: 1.05,
          weeks_played: 10,
        },
        {
          player_id: "p1",
          scoring: "pts_ppr",
          season: null,
          source: BEACON_SOURCE,
          shrunk_multiplier: 0.95,
          weeks_played: 10,
        },
      ],
    });

    const result = await loadAdjustedProjections({
      supabase: client,
      playerIds: ["p1"],
      season: 2026,
      fromWeek: 10,
      toWeek: 10,
      scoringSettings: PPR_SCORING,
      positionByPlayer: new Map([["p1", "RB"]]),
      currentWeek: 10,
    });

    expect(result.source).toBe(BEACON_SOURCE);
    const week10 = result.byPlayer.get("p1")!.byWeek.get(10)!;
    // rush_att 10*0 + rush_yd 100*0.1 = 10.
    expect(week10.rawPoints).toBeCloseTo(10, 6);
    // The ffbeacon-source row's multiplier (0.95), never the sleeper-source
    // row's (1.05): 10 * 0.95 = 9.5.
    expect(week10.points).toBeCloseTo(9.5, 6);
  });

  it("applies the sleeper-source multiplier when the feature is off, even though a differing ffbeacon row exists", async () => {
    const stat_line = { rush_att: 10, rush_yd: 100 };
    const client = fakeClient({
      league_power_pulse_settings: [
        { id: "global", settings: { beaconProjections: { enabled: false } } },
      ],
      player_weekly_projections: [
        projectionRow({ id: "r1", player_id: "p1", week: 10, source: SLEEPER_SOURCE, stat_line }),
        projectionRow({ id: "r2", player_id: "p1", week: 10, source: BEACON_SOURCE, stat_line }),
      ],
      player_projection_accuracy: [
        {
          player_id: "p1",
          scoring: "pts_ppr",
          season: null,
          source: SLEEPER_SOURCE,
          shrunk_multiplier: 1.05,
          weeks_played: 10,
        },
        {
          player_id: "p1",
          scoring: "pts_ppr",
          season: null,
          source: BEACON_SOURCE,
          shrunk_multiplier: 0.95,
          weeks_played: 10,
        },
      ],
    });

    const result = await loadAdjustedProjections({
      supabase: client,
      playerIds: ["p1"],
      season: 2026,
      fromWeek: 10,
      toWeek: 10,
      scoringSettings: PPR_SCORING,
      positionByPlayer: new Map([["p1", "RB"]]),
      currentWeek: 10,
    });

    expect(result.source).toBe(SLEEPER_SOURCE);
    const week10 = result.byPlayer.get("p1")!.byWeek.get(10)!;
    expect(week10.rawPoints).toBeCloseTo(10, 6);
    // The sleeper-source row's multiplier (1.05): 10 * 1.05 = 10.5.
    expect(week10.points).toBeCloseTo(10.5, 6);
  });

  // FINDING 4 regression guard. loadPowerPulseSettings and
  // availableProjectionSources used to run in Promise.all before enabled was
  // checked, so availableProjectionSources's two count probes fired on every
  // render even though the feature ships disabled. They must now be skipped
  // entirely when it is off.
  //
  // loadProjections (lib/power-pulse/load.ts) runs its OWN independent
  // count-then-page guard against player_weekly_projections regardless of
  // whether the feature is on, so a disabled run still shows exactly one head
  // probe from that, unrelated to this finding. The assertion below is
  // therefore a DELTA: enabling the feature must add exactly the two probes
  // availableProjectionSources issues (one per candidate source), no more and
  // no fewer, on top of whatever loadProjections needed anyway.
  function buildTables(enabled: boolean) {
    return {
      league_power_pulse_settings: [
        { id: "global", settings: { beaconProjections: { enabled } } },
      ],
      player_weekly_projections: [
        projectionRow({
          id: "r1",
          player_id: "p1",
          week: 10,
          stat_line: { rush_att: 10, rush_yd: 50 },
        }),
      ],
    };
  }

  async function runAndCountHeadProbes(enabled: boolean): Promise<number> {
    const headProbes: string[] = [];
    const client = fakeClient(buildTables(enabled), headProbes);
    await loadAdjustedProjections({
      supabase: client,
      playerIds: ["p1"],
      season: 2026,
      fromWeek: 10,
      toWeek: 10,
      scoringSettings: PPR_SCORING,
      positionByPlayer: new Map([["p1", "RB"]]),
      currentWeek: 10,
    });
    return headProbes.length;
  }

  it("skips the availability count probes entirely when the feature is off", async () => {
    const headProbes: string[] = [];
    const client = fakeClient(buildTables(false), headProbes);

    const result = await loadAdjustedProjections({
      supabase: client,
      playerIds: ["p1"],
      season: 2026,
      fromWeek: 10,
      toWeek: 10,
      scoringSettings: PPR_SCORING,
      positionByPlayer: new Map([["p1", "RB"]]),
      currentWeek: 10,
    });

    expect(result.source).toBe(SLEEPER_SOURCE);
    // Whatever count probes fired belong to loadProjections's own pagination
    // guard, never to availableProjectionSources: none of them may be the
    // second, redundant probe pair this finding is about.
    expect(headProbes.filter((t) => t === "player_weekly_projections").length).toBeLessThanOrEqual(1);
  });

  it("adds exactly the two availableProjectionSources probes when the feature is on, no more", async () => {
    const off = await runAndCountHeadProbes(false);
    const on = await runAndCountHeadProbes(true);
    expect(on - off).toBe(2);
  });
});
