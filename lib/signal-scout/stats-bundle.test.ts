import { describe, it, expect, vi } from "vitest";
import { loadStatsBundle, pointsPerGame, deriveCareerHighs } from "./stats-bundle";
import type { WeeklyStatRow } from "@/lib/player-profile";
import type { SeasonAgg } from "@/components/player-profile/stat-shaping";

// --- pointsPerGame -----------------------------------------------------

describe("pointsPerGame", () => {
  it("rounds to one decimal, matching the stats-tab toFixed(1) display", () => {
    expect(pointsPerGame(250, 10)).toBe(25);
    expect(pointsPerGame(333.3, 3)).toBe(111.1);
    expect(pointsPerGame(100, 3)).toBe(33.3);
  });

  it("returns null when games is 0", () => {
    expect(pointsPerGame(120, 0)).toBeNull();
  });

  it("returns null for negative games", () => {
    expect(pointsPerGame(120, -2)).toBeNull();
  });
});

// --- deriveCareerHighs ---------------------------------------------------

function makeSeason(
  season: number,
  opts: { games?: number; pts?: number; passYd?: number; rushYd?: number; recYd?: number } = {},
): SeasonAgg {
  return {
    season,
    games: opts.games ?? 16,
    line: {
      pass_cmp: 0,
      pass_att: 0,
      pass_yd: opts.passYd ?? 0,
      pass_td: 0,
      pass_int: 0,
      rush_att: 0,
      rush_yd: opts.rushYd ?? 0,
      rush_td: 0,
      rec: 0,
      rec_tgt: 0,
      rec_yd: opts.recYd ?? 0,
      rec_td: 0,
      pts_ppr: opts.pts ?? 0,
    },
  };
}

describe("deriveCareerHighs", () => {
  it("picks the season with the highest points and the highest total yards", () => {
    const seasons = [
      makeSeason(2023, { pts: 280, passYd: 4000, rushYd: 200, recYd: 0 }),
      makeSeason(2022, { pts: 310, passYd: 4500, rushYd: 300, recYd: 0 }),
      makeSeason(2021, { pts: 150, passYd: 2000, rushYd: 100, recYd: 0 }),
    ];
    const highs = deriveCareerHighs(seasons);
    expect(highs.points).toEqual({ season: 2022, value: 310 });
    expect(highs.totalYards).toEqual({ season: 2022, value: 4800 });
  });

  it("picks total yards as pass + rush + rec combined", () => {
    const seasons = [
      makeSeason(2022, { passYd: 100, rushYd: 50, recYd: 25 }),
      makeSeason(2021, { passYd: 0, rushYd: 0, recYd: 1000 }),
    ];
    const highs = deriveCareerHighs(seasons);
    expect(highs.totalYards).toEqual({ season: 2021, value: 1000 });
  });

  it("breaks ties by keeping the more recent season (first in most-recent-first order)", () => {
    const seasons = [makeSeason(2023, { pts: 300 }), makeSeason(2022, { pts: 300 })];
    const highs = deriveCareerHighs(seasons);
    expect(highs.points?.season).toBe(2023);
  });

  it("returns nulls on empty input", () => {
    const highs = deriveCareerHighs([]);
    expect(highs.points).toBeNull();
    expect(highs.totalYards).toBeNull();
  });
});

// --- loadStatsBundle -----------------------------------------------------

/**
 * Minimal chainable + thenable Supabase mock. The `gte("season", floor)` call
 * actually filters the canned rows by season so the loader's real query shape
 * (order of .eq/.gte/.order calls) can be exercised without a live database.
 */
function mockStatsSupabase(rows: WeeklyStatRow[], rpc: { data: unknown; error: unknown }) {
  let seasonFloor: number | undefined;
  const rpcSpy = vi.fn(() => Promise.resolve(rpc));
  const builder: {
    select: () => typeof builder;
    eq: () => typeof builder;
    gte: (col: string, val: number) => typeof builder;
    order: () => typeof builder;
    then: (
      resolve: (v: { data: unknown; error: unknown }) => void,
      reject: (e: unknown) => void,
    ) => void;
  } = {
    select: () => builder,
    eq: () => builder,
    gte: (_col, val) => {
      seasonFloor = val;
      return builder;
    },
    order: () => builder,
    then: (resolve) => {
      const filtered = seasonFloor === undefined ? rows : rows.filter((r) => r.season >= seasonFloor!);
      resolve({ data: filtered, error: null });
    },
  };
  const supabase = { from: () => builder, rpc: rpcSpy };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, rpcSpy };
}

function makeRow(season: number, week: number, pts: number, gp = 1): WeeklyStatRow {
  return {
    season,
    week,
    opponent: "KC",
    snap_pct: 80,
    gp,
    pass_cmp: 0,
    pass_att: 0,
    pass_yd: 0,
    pass_td: 0,
    pass_int: 0,
    rush_att: 0,
    rush_yd: 0,
    rush_td: 0,
    rec: 5,
    rec_tgt: 8,
    rec_yd: 60,
    rec_td: 1,
    metadata: { stats: { pts_ppr: pts } },
  };
}

describe("loadStatsBundle", () => {
  it("respects the 2020 season floor, excluding earlier seasons", async () => {
    const rows = [makeRow(2018, 1, 10), makeRow(2019, 1, 12), makeRow(2020, 1, 15), makeRow(2021, 1, 20)];
    const { supabase } = mockStatsSupabase(rows, { data: [], error: null });
    const bundle = await loadStatsBundle(supabase, "player-1");
    const seasonNumbers = bundle.seasons.map((s) => s.season);
    expect(seasonNumbers).toEqual([2021, 2020]);
    expect(seasonNumbers).not.toContain(2018);
    expect(seasonNumbers).not.toContain(2019);
  });

  it("returns hasData false and empty/null fields for a player with no 2020+ rows", async () => {
    const { supabase, rpcSpy } = mockStatsSupabase([], { data: [], error: null });
    const bundle = await loadStatsBundle(supabase, "player-empty");
    expect(bundle.hasData).toBe(false);
    expect(bundle.seasons).toEqual([]);
    expect(bundle.lastSeason).toBeNull();
    expect(bundle.careerHighs.points).toBeNull();
    expect(bundle.careerHighs.totalYards).toBeNull();
    expect(bundle.pointsPerGame).toEqual({});
    expect(bundle.finishes.seasons).toEqual([]);
    expect(bundle.finishes.bestFinish).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("finds the most recent season with games played as lastSeason", async () => {
    const rows = [makeRow(2022, 1, 20, 0), makeRow(2021, 1, 18, 1)];
    const { supabase } = mockStatsSupabase(rows, { data: [], error: null });
    const bundle = await loadStatsBundle(supabase, "player-lastseason");
    expect(bundle.lastSeason?.season).toBe(2021);
  });

  it("shapes finishes to PPR only and picks the best (lowest) finish, tying to the more recent season", async () => {
    const rows = [makeRow(2021, 1, 20), makeRow(2022, 1, 25)];
    const rpcData = [
      { season: 2021, scoring: "pts_ppr", finish: 5, players_ranked: 60, total_points: 200 },
      { season: 2021, scoring: "pts_half_ppr", finish: 3, players_ranked: 60, total_points: 190 },
      { season: 2022, scoring: "pts_ppr", finish: 5, players_ranked: 60, total_points: 210 },
    ];
    const { supabase } = mockStatsSupabase(rows, { data: rpcData, error: null });
    const bundle = await loadStatsBundle(supabase, "player-finish");
    expect(bundle.finishes.seasons).toEqual([
      { season: 2022, finish: 5, playersRanked: 60 },
      { season: 2021, finish: 5, playersRanked: 60 },
    ]);
    expect(bundle.finishes.bestFinish).toEqual({ season: 2022, finish: 5, playersRanked: 60 });
  });

  it("tolerates an RPC error and still returns the rest of the bundle", async () => {
    const rows = [makeRow(2021, 1, 20)];
    const { supabase } = mockStatsSupabase(rows, { data: null, error: { message: "boom" } });
    const bundle = await loadStatsBundle(supabase, "player-rpc-fail");
    expect(bundle.hasData).toBe(true);
    expect(bundle.finishes.seasons).toEqual([]);
    expect(bundle.finishes.bestFinish).toBeNull();
  });
});
