import { describe, it, expect } from "vitest";
import {
  projectedPointsForScoring,
  effectiveProjectedPoints,
  summarizeProjections,
  pointsFromProjectedSet,
  actualPointsForScoring,
  type PlayerProjections,
  type WeeklyProjectionRow,
} from "./player-profile";
import {
  lineFromProjection,
  projectionStatColumns,
} from "@/components/player-profile/stat-shaping";

function row(over: Partial<WeeklyProjectionRow>): WeeklyProjectionRow {
  return {
    season: 2026,
    week: 1,
    opponent: "NO",
    team: "DET",
    ppr: 20,
    half_ppr: 18,
    std: 16,
    stats: null,
    played: false,
    ...over,
  };
}

function proj(rows: WeeklyProjectionRow[]): PlayerProjections {
  return {
    season: rows[0]?.season ?? null,
    rows,
    seasonStarted: rows.some((r) => r.played),
  };
}

describe("projectedPointsForScoring", () => {
  it("selects the column matching the scoring key", () => {
    const r = row({ ppr: 20.5, half_ppr: 18.6, std: 16.7 });
    expect(projectedPointsForScoring(r, "pts_ppr")).toBe(20.5);
    expect(projectedPointsForScoring(r, "pts_half_ppr")).toBe(18.6);
    expect(projectedPointsForScoring(r, "pts_std")).toBe(16.7);
  });
});

describe("summarizeProjections", () => {
  it("treats every week as upcoming pre-kickoff (full season)", () => {
    const s = summarizeProjections(
      proj([
        row({ week: 1, ppr: 20 }),
        row({ week: 2, ppr: 10 }),
        row({ week: 3, ppr: 30 }),
      ]),
      "pts_ppr",
    );
    expect(s.seasonStarted).toBe(false);
    expect(s.upcomingWeeks).toBe(3);
    expect(s.totalPoints).toBe(60);
    expect(s.perGame).toBe(20);
    expect(s.nextGame?.week).toBe(1);
    expect(s.nextGamePoints).toBe(20);
  });

  it("excludes played weeks so the total is rest-of-season", () => {
    const s = summarizeProjections(
      proj([
        row({ week: 1, ppr: 20, played: true }),
        row({ week: 2, ppr: 10, played: true }),
        row({ week: 3, ppr: 30, played: false }),
        row({ week: 4, ppr: 15, played: false }),
      ]),
      "pts_ppr",
    );
    expect(s.seasonStarted).toBe(true);
    expect(s.upcomingWeeks).toBe(2);
    expect(s.totalPoints).toBe(45);
    expect(s.perGame).toBe(22.5);
    // Soonest UNPLAYED week, not the lowest week overall.
    expect(s.nextGame?.week).toBe(3);
  });

  it("honors the active scoring format when summing", () => {
    const rows = [row({ week: 1, std: 12 }), row({ week: 2, std: 8 })];
    const s = summarizeProjections(proj(rows), "pts_std");
    expect(s.totalPoints).toBe(20);
    expect(s.nextGamePoints).toBe(12);
  });

  it("skips weeks with a null projection for the active scoring", () => {
    const s = summarizeProjections(
      proj([
        row({ week: 1, half_ppr: null }),
        row({ week: 2, half_ppr: 9 }),
      ]),
      "pts_half_ppr",
    );
    expect(s.upcomingWeeks).toBe(1);
    expect(s.totalPoints).toBe(9);
    expect(s.nextGame?.week).toBe(2);
  });

  it("returns an empty outlook when no projections exist", () => {
    const s = summarizeProjections({ season: null, rows: [], seasonStarted: false }, "pts_ppr");
    expect(s.season).toBeNull();
    expect(s.upcomingWeeks).toBe(0);
    expect(s.totalPoints).toBe(0);
    expect(s.perGame).toBeNull();
    expect(s.nextGame).toBeNull();
    expect(s.nextGamePoints).toBeNull();
  });
});

describe("effectiveProjectedPoints (tight end premium)", () => {
  it("returns the base points when no premium applies", () => {
    const r = row({ ppr: 12, stats: { rec: 5 } });
    expect(effectiveProjectedPoints(r, "pts_ppr", 0)).toBe(12);
  });

  it("adds bonus x projected receptions to the base points", () => {
    const r = row({ ppr: 12, stats: { rec: 5 } });
    // 12 base + 0.5 * 5 receptions = 14.5
    expect(effectiveProjectedPoints(r, "pts_ppr", 0.5)).toBe(14.5);
  });

  it("treats a missing reception projection as zero bonus", () => {
    const r = row({ ppr: 8, stats: { rush_yd: 40 } });
    expect(effectiveProjectedPoints(r, "pts_ppr", 0.5)).toBe(8);
  });

  it("never invents points when the base scoring is null", () => {
    const r = row({ half_ppr: null, stats: { rec: 6 } });
    expect(effectiveProjectedPoints(r, "pts_half_ppr", 0.5)).toBeNull();
  });
});

describe("summarizeProjections with a tight end premium", () => {
  it("bakes the premium into the total, per game, and next game", () => {
    const s = summarizeProjections(
      proj([
        row({ week: 1, ppr: 10, stats: { rec: 4 } }),
        row({ week: 2, ppr: 12, stats: { rec: 6 } }),
      ]),
      "pts_ppr",
      0.5,
    );
    // Week 1: 10 + 0.5*4 = 12 ; Week 2: 12 + 0.5*6 = 15 ; total 27
    expect(s.totalPoints).toBe(27);
    expect(s.perGame).toBe(13.5);
    expect(s.nextGamePoints).toBe(12);
  });

  it("leaves the total unchanged when the premium is zero", () => {
    const rows = [row({ week: 1, ppr: 10, stats: { rec: 4 } })];
    expect(summarizeProjections(proj(rows), "pts_ppr", 0).totalPoints).toBe(10);
  });
});

describe("pointsFromProjectedSet (projection-map lookup)", () => {
  const set = { ppr: 18, half_ppr: 15, std: 12, rec: 6 };

  it("returns the base points for the active scoring", () => {
    expect(pointsFromProjectedSet(set, "pts_ppr")).toBe(18);
    expect(pointsFromProjectedSet(set, "pts_half_ppr")).toBe(15);
    expect(pointsFromProjectedSet(set, "pts_std")).toBe(12);
  });

  it("adds the TE premium against projected receptions", () => {
    // 18 + 0.5 * 6 = 21
    expect(pointsFromProjectedSet(set, "pts_ppr", 0.5)).toBe(21);
  });

  it("returns null for a missing set or null base scoring", () => {
    expect(pointsFromProjectedSet(undefined, "pts_ppr")).toBeNull();
    expect(pointsFromProjectedSet({ ppr: null, half_ppr: 9, std: 8, rec: 3 }, "pts_ppr")).toBeNull();
  });
});

describe("actualPointsForScoring", () => {
  const meta = { stats: { pts_ppr: 20, pts_half_ppr: 17, pts_std: 14 } };

  it("reads the active scoring from metadata", () => {
    expect(actualPointsForScoring(meta, 6, "pts_ppr")).toBe(20);
    expect(actualPointsForScoring(meta, 6, "pts_std")).toBe(14);
  });

  it("adds the TE premium against actual receptions", () => {
    // 20 + 0.5 * 6 = 23
    expect(actualPointsForScoring(meta, 6, "pts_ppr", 0.5)).toBe(23);
  });

  it("treats null receptions as zero premium", () => {
    expect(actualPointsForScoring(meta, null, "pts_ppr", 0.5)).toBe(20);
  });
});

describe("lineFromProjection", () => {
  it("pulls skill-position component stats out of the raw stat_line", () => {
    const line = lineFromProjection({ rush_yd: 90.2, rush_td: 0.76, rec: 3.84, rec_yd: 23.1 });
    expect(line.rush_yd).toBeCloseTo(90.2);
    expect(line.rush_td).toBeCloseTo(0.76);
    expect(line.rec).toBeCloseTo(3.84);
    expect(line.rec_yd).toBeCloseTo(23.1);
    // Missing keys default to 0, never NaN.
    expect(line.pass_yd).toBe(0);
  });

  it("coerces a null stat_line to an all-zero line", () => {
    const line = lineFromProjection(null);
    expect(line.rush_yd).toBe(0);
    expect(line.rec_td).toBe(0);
  });
});

describe("projectionStatColumns", () => {
  it("keeps low-magnitude counts to one decimal so fractional TDs survive", () => {
    const cols = projectionStatColumns("RB");
    const line = lineFromProjection({ rush_att: 17.3, rush_yd: 90.2, rush_td: 0.76, rec: 3.84 });
    const td = cols.find((c) => c.label === "Rush TD")!;
    const yd = cols.find((c) => c.label === "Rush Yd")!;
    expect(td.get(line)).toBe("0.8");
    expect(yd.get(line)).toBe("90");
  });

  it("returns no component columns for K/DEF", () => {
    expect(projectionStatColumns("K")).toEqual([]);
    expect(projectionStatColumns("DEF")).toEqual([]);
  });
});
