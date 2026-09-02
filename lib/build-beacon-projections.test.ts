/**
 * Coverage for the write-loop change in lib/build-beacon-projections.ts
 * (projection engine review, finding 3): the mirrored row's own
 * sleeper_player_id is now the primary write key, and a player-week that
 * still has none after the engine's own fallback is counted and logged
 * rather than dropped with no evidence it happened.
 *
 * The rest of this file is deliberately untested here, matching its own
 * header: it is "the I/O half", and every judgement it makes lives in
 * lib/projections/, which is pure and gets its own test files (engine.test.ts
 * in particular pins the sleeperPlayerId preference this test exercises end
 * to end). This file is the smallest fake Supabase client that satisfies one
 * full run of runBuildBeaconProjections, in the spirit of the house pattern
 * used in lib/projections/read.test.ts and lib/power-pulse/load.test.ts.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { runBuildBeaconProjections } from "./build-beacon-projections";

type Row = Record<string, unknown>;

function fakeClient(opts: {
  sleeperRows: Row[];
  players: Row[];
  upserted: Row[][];
}): SupabaseClient<Database> {
  function builderFor(table: string) {
    let mode: "select" | "upsert" | "delete" | null = null;

    const b: Record<string, unknown> = {
      select() {
        if (mode === null) mode = "select";
        return b;
      },
      eq: () => b,
      gte: () => b,
      lte: () => b,
      lt: () => b,
      not: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      range: () => b,
      gt: () => b,
      maybeSingle: () => b,
      upsert(rows: Row[]) {
        mode = "upsert";
        opts.upserted.push(rows);
        return b;
      },
      delete() {
        mode = "delete";
        return b;
      },
      then(resolve: (v: unknown) => void) {
        if (mode === "upsert") {
          resolve({ error: null });
          return;
        }
        if (mode === "delete") {
          resolve({ data: [], error: null });
          return;
        }
        // mode === "select"
        switch (table) {
          case "league_power_pulse_settings":
            // No stored row: the builder falls back to code defaults.
            resolve({ data: null, error: null });
            return;
          case "player_weekly_projections":
            resolve({ data: opts.sleeperRows, error: null });
            return;
          case "players":
            resolve({ data: opts.players, error: null });
            return;
          case "player_stats":
          case "nfl_game_odds":
            resolve({ data: [], error: null });
            return;
          default:
            resolve({ data: [], error: null });
        }
      },
    };
    return b;
  }

  return {
    from: (table: string) => builderFor(table),
  } as unknown as SupabaseClient<Database>;
}

function sleeperRow(over: Partial<Row> & { id: string; player_id: string; sleeper_player_id: string }): Row {
  return {
    week: 1,
    opponent: "CHI",
    team: "DET",
    stat_line: null,
    availability: "unprojected",
    projected_pts_ppr: 5,
    projected_pts_half_ppr: 4,
    projected_pts_std: 3,
    ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runBuildBeaconProjections: write key and drop accounting", () => {
  it("writes a player-week using the mirrored row's own sleeper_player_id even when the players table has no mapping for him", async () => {
    const upserted: Row[][] = [];
    const client = fakeClient({
      sleeperRows: [
        sleeperRow({ id: "s1", player_id: "player-good", sleeper_player_id: "authoritative-good" }),
      ],
      // No external_ids.sleeper on the players row at all: before this fix,
      // that alone would have dropped the player-week.
      players: [{ id: "player-good", position: "RB", team: "DET", external_ids: {} }],
      upserted,
    });

    const result = await runBuildBeaconProjections(client, {
      season: 2026,
      fromWeek: 1,
      toWeek: 1,
    });

    expect(result.skipped).toBe(false);
    expect(result.droppedNoSleeperId).toBe(0);
    expect(result.rowsWritten).toBe(1);
    const rows = upserted.flat();
    expect(rows).toHaveLength(1);
    expect(rows[0].player_id).toBe("player-good");
    expect(rows[0].sleeper_player_id).toBe("authoritative-good");
  });

  it("counts and logs a player-week that has no sleeper_player_id anywhere, rather than dropping it silently", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const upserted: Row[][] = [];
    const client = fakeClient({
      sleeperRows: [
        sleeperRow({ id: "s1", player_id: "player-good", sleeper_player_id: "authoritative-good" }),
        // Neither the mirrored row nor the players table has an id for this one.
        sleeperRow({ id: "s2", player_id: "player-bad", sleeper_player_id: "" }),
      ],
      players: [
        { id: "player-good", position: "RB", team: "DET", external_ids: {} },
        { id: "player-bad", position: "RB", team: "DET", external_ids: {} },
      ],
      upserted,
    });

    const result = await runBuildBeaconProjections(client, {
      season: 2026,
      fromWeek: 1,
      toWeek: 1,
    });

    expect(result.skipped).toBe(false);
    expect(result.droppedNoSleeperId).toBe(1);
    expect(result.rowsWritten).toBe(1);
    const rows = upserted.flat();
    expect(rows.map((r) => r.player_id)).toEqual(["player-good"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("player-bad");
  });

  it("returns phase timings for every named phase, so a slow run can be diagnosed", async () => {
    const upserted: Row[][] = [];
    const client = fakeClient({
      sleeperRows: [
        sleeperRow({ id: "s1", player_id: "player-good", sleeper_player_id: "authoritative-good" }),
      ],
      players: [{ id: "player-good", position: "RB", team: "DET", external_ids: {} }],
      upserted,
    });

    const result = await runBuildBeaconProjections(client, {
      season: 2026,
      fromWeek: 1,
      toWeek: 1,
    });

    expect(Object.keys(result.phaseTimings).sort()).toEqual(
      ["clearStale", "compute", "environment", "sleeperLoad", "stats", "subjects", "upsert"].sort(),
    );
    for (const ms of Object.values(result.phaseTimings)) {
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });
});
