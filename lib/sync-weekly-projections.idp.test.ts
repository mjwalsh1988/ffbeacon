/**
 * IDP projections in the one weekly fetch (plan IDP-114, hazards A, D, G, I).
 *
 * Row shapes follow the live 2026 week 3 IDP response recorded in the plan
 * (section 4.4): projected defenders carry idp_* keys and a game_id, some carry
 * team-defense keys and meaningless pts_*, and thousands of ADP-only rows
 * arrive with neither a game nor a stat.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SleeperWeeklyProjection } from "./sleeper";

const fetchWeek = vi.fn();
vi.mock("./sleeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sleeper")>();
  return { ...actual, getSleeperWeeklyProjections: (...args: unknown[]) => fetchWeek(...args) };
});
vi.mock("./sync-sleeper-stats", () => ({
  loadSleeperIdMap: async () => new Map([["wr1", "p-wr1"], ["dl1", "p-dl1"], ["two", "p-two"]]),
}));

import {
  classifyRow,
  dedupeProjectionRows,
  isDefenderProjectionRow,
  runWeeklyProjectionsSync,
} from "./sync-weekly-projections";

function row(partial: Partial<SleeperWeeklyProjection>): SleeperWeeklyProjection {
  return { player_id: "0", season: "2026", season_type: "regular", week: 3, stats: {}, ...partial } as SleeperWeeklyProjection;
}

const WR = row({
  player_id: "wr1",
  game_id: "g1",
  opponent: "DAL",
  stats: { rec: 5.2, rec_yd: 61, pts_ppr: 13.3, pts_half_ppr: 10.7, pts_std: 8.1 },
  player: { position: "WR", fantasy_positions: ["WR"] },
});
const DL = row({
  player_id: "dl1",
  game_id: "g2",
  opponent: "NYG",
  stats: { idp_tkl: 4.1, idp_tkl_solo: 2.6, idp_tkl_ast: 1.5, idp_sack: 0.5, def_pr_yd: 2.2, pts_ppr: 0.4, adp_idp: 88 },
  player: { position: "DE", fantasy_positions: ["DL"] },
});

describe("classifyRow for defenders", () => {
  it("calls a defender with idp stats and a game projected", () => {
    expect(classifyRow(row({ game_id: "g", stats: { idp_tkl_solo: 3 }, player: { fantasy_positions: ["LB"] } }))).toBe(
      "projected",
    );
  });

  it("calls a designated defender with a game and no stats out, a healthy one unprojected", () => {
    expect(classifyRow(row({ game_id: "g", player: { fantasy_positions: ["LB"], injury_status: "Out" } }))).toBe("out");
    expect(classifyRow(row({ game_id: "g", player: { fantasy_positions: ["LB"] } }))).toBe("unprojected");
  });

  it("drops an ADP-only placeholder with neither a game nor a stat", () => {
    expect(classifyRow(row({ stats: { adp_idp: 140 }, player: { fantasy_positions: ["DB"] } }))).toBe("bye");
  });
});

describe("isDefenderProjectionRow", () => {
  it("reads the fantasy label, and keeps a two-way DB/WR player on offense", () => {
    expect(isDefenderProjectionRow(DL)).toBe(true);
    expect(isDefenderProjectionRow(WR)).toBe(false);
    expect(isDefenderProjectionRow(row({ player: { fantasy_positions: ["DB", "WR"] } }))).toBe(false);
    expect(isDefenderProjectionRow(row({ player: { position: "CB" } }))).toBe(true);
    expect(isDefenderProjectionRow(row({ player: { position: "DEF", fantasy_positions: ["DEF"] } }))).toBe(false);
  });
});

describe("dedupeProjectionRows", () => {
  it("merges a player listed twice into one row with both stat sets", () => {
    const a = row({ player_id: "two", game_id: "g", stats: { rec: 2, pts_ppr: 5 } });
    const b = row({ player_id: "two", game_id: "g", stats: { idp_tkl: 3, pts_ppr: 99 } });
    const out = dedupeProjectionRows([a, b, WR]);
    expect(out).toHaveLength(2);
    const merged = out.find((r) => r.player_id === "two")!;
    expect(merged.stats).toEqual({ rec: 2, pts_ppr: 5, idp_tkl: 3 });
  });
});

describe("runWeeklyProjectionsSync with defenders in the feed", () => {
  const upserted: Record<string, unknown>[][] = [];

  beforeEach(() => {
    upserted.length = 0;
    fetchWeek.mockReset();
    fetchWeek.mockResolvedValue([
      WR,
      DL,
      // Listed twice (DB and WR requests both return him).
      row({ player_id: "two", game_id: "g3", stats: { rec: 2, pts_ppr: 5 }, player: { fantasy_positions: ["DB", "WR"] } }),
      row({ player_id: "two", game_id: "g3", stats: { idp_tkl: 3 }, player: { fantasy_positions: ["DB", "WR"] } }),
      row({ player_id: "adp-only", stats: { adp_idp: 120 }, player: { fantasy_positions: ["LB"] } }),
    ]);
  });

  const supabase = {
    from: () => ({
      upsert: async (chunk: Record<string, unknown>[]) => {
        upserted.push(chunk);
        return { error: null };
      },
    }),
  };

  it("makes ONE Sleeper call for the week and stores offense and defense together", async () => {
    await runWeeklyProjectionsSync(supabase as never, { season: 2026, fromWeek: 3, toWeek: 3, clearStale: false });
    expect(fetchWeek).toHaveBeenCalledTimes(1);

    const rows = upserted.flat();
    const ids = rows.map((r) => r.sleeper_player_id);
    expect(ids).toContain("wr1");
    expect(ids).toContain("dl1");
    expect(ids).not.toContain("adp-only");
    for (const chunk of upserted) {
      const keys = chunk.map((r) => r.sleeper_player_id);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("stores a defender's idp line only, with no points in the offensive columns", async () => {
    await runWeeklyProjectionsSync(supabase as never, { season: 2026, fromWeek: 3, toWeek: 3, clearStale: false });
    const dl = upserted.flat().find((r) => r.sleeper_player_id === "dl1")!;
    expect(dl.availability).toBe("projected");
    expect(dl.stat_line).toEqual({ idp_tkl: 4.1, idp_tkl_solo: 2.6, idp_tkl_ast: 1.5, idp_sack: 0.5 });
    expect(dl.projected_pts_ppr).toBeNull();
    expect(dl.projected_pts_half_ppr).toBeNull();
    expect(dl.projected_pts_std).toBeNull();

    const wr = upserted.flat().find((r) => r.sleeper_player_id === "wr1")!;
    expect(wr.projected_pts_ppr).toBe(13.3);
    expect(wr.stat_line).toEqual(WR.stats);
  });
});

describe("the IDP-only history backfill (IDP-116)", () => {
  it("refuses a position-narrowed fetch with the stale sweep on", async () => {
    await expect(
      runWeeklyProjectionsSync({} as never, { season: 2022, fromWeek: 1, toWeek: 1, positions: ["DL"] }),
    ).rejects.toThrow(/clearStale false/);
  });

  it("passes the narrowed position list to the one fetch", async () => {
    fetchWeek.mockReset();
    fetchWeek.mockResolvedValue([]);
    await runWeeklyProjectionsSync({ from: () => ({}) } as never, {
      season: 2022,
      fromWeek: 8,
      toWeek: 8,
      clearStale: false,
      positions: ["DL", "LB", "DB"],
    });
    expect(fetchWeek).toHaveBeenCalledWith(2022, 8, "regular", ["DL", "LB", "DB"]);
  });
});
