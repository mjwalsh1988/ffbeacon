import { describe, it, expect } from "vitest";
import { scoringFor } from "./board";
import {
  BEAT_MIN_PROJECTION,
  LETDOWN_MIN_PROJECTION,
  buildProjectionReport,
  buildWeekPerformances,
  buildWeekSpotlights,
  gradeWeeks,
  statLine,
} from "./week-report";
import type { GradedWeek, PlayerRef, SeasonPosition, WeekStatRow } from "./types";

const PPR = scoringFor({ scoring_type: "ppr", te_premium_bonus: null });

function ref(id: string, position: SeasonPosition): PlayerRef {
  return { id, slug: id, name: id, position, team: "BUF", sleeperId: null };
}

function row(playerId: string, week: number, position: SeasonPosition, ppr: number): WeekStatRow {
  return {
    playerId,
    week,
    position,
    team: "BUF",
    opponent: "NE",
    ppr,
    half: ppr,
    std: ppr,
    snapPct: null,
    stats: {},
  };
}

describe("statLine", () => {
  it("reads a quarterback's passing then rushing", () => {
    expect(
      statLine("QB", { pass_cmp: 24, pass_att: 33, pass_yd: 281, pass_td: 3, pass_int: 1, rush_att: 5, rush_yd: 32 }),
    ).toBe("24 of 33, 281 passing yards, 3 TD, 1 INT; 5 carries, 32 rushing yards");
  });

  it("says one carry and one catch in the singular", () => {
    expect(statLine("RB", { rush_att: 1, rush_yd: 4, rec: 1, rec_tgt: 1, rec_yd: 9 })).toBe(
      "1 carry, 4 rushing yards; 1 catch on 1 target, 9 receiving yards",
    );
  });

  it("reads a receiver's catches before his carries", () => {
    expect(statLine("WR", { rec: 7, rec_tgt: 10, rec_yd: 112, rec_td: 1 })).toBe(
      "7 catches on 10 targets, 112 receiving yards, 1 TD",
    );
  });

  it("reads a kicker and a defense in their own terms", () => {
    expect(statLine("K", { fgm: 3, fga: 4, xpm: 2 })).toBe("3 of 4 field goals, 2 extra points");
    expect(statLine("DEF", { pts_allow: 17, sack: 4, interceptions: 1 })).toBe(
      "17 points allowed, 4 sacks, 1 interception",
    );
  });

  it("says so when there is nothing to read", () => {
    expect(statLine("WR", {})).toBe("No counting stats recorded");
  });
});

describe("week performances and spotlights", () => {
  const players = new Map(
    [ref("star", "WR"), ref("beat", "RB"), ref("nobody", "WR"), ref("dud", "QB"), ref("kick", "K")].map((r) => [
      r.id,
      r,
    ]),
  );
  const rows = [
    row("star", 3, "WR", 35),
    row("beat", 3, "RB", 24),
    row("nobody", 3, "WR", 18),
    row("dud", 3, "QB", 6),
    row("kick", 3, "K", 20),
    // A different week must not leak in.
    row("star", 2, "WR", 99),
  ];
  const projected = new Map([
    ["star", 20],
    ["beat", 10],
    ["nobody", 3],
    ["dud", 21],
  ]);
  const performances = buildWeekPerformances({ week: 3, scoring: PPR, rows, players, projected });
  const spot = buildWeekSpotlights(3, performances);

  it("reads only the week asked for", () => {
    expect(performances.map((p) => p.points)).not.toContain(99);
  });

  it("ranks a performance within its own position for the week", () => {
    const byId = new Map(performances.map((p) => [p.id, p]));
    expect(byId.get("star")?.weekRank).toBe(1);
    expect(byId.get("nobody")?.weekRank).toBe(2);
    expect(byId.get("beat")?.weekRank).toBe(1);
  });

  it("leaves the projection null when none was published, never zero", () => {
    expect(performances.find((p) => p.id === "kick")?.projected).toBeNull();
    expect(performances.find((p) => p.id === "kick")?.diff).toBeNull();
  });

  it("names the highest skill-position scores as the best, kickers excluded", () => {
    expect(spot.best.map((p) => p.id)).toEqual(["star", "beat", "nobody", "dud"]);
  });

  it("counts a beat only against a real projection", () => {
    // "nobody" beat a 3-point projection by 15, which is not a beat worth naming.
    expect(BEAT_MIN_PROJECTION).toBeGreaterThan(3);
    expect(spot.beats.map((p) => p.id)).toEqual(["star", "beat"]);
  });

  it("names a big week from a player projected for little as a surprise", () => {
    expect(spot.surprises.map((p) => p.id)).toEqual(["nobody"]);
  });

  it("names a small week from a player projected for a lot as a letdown", () => {
    expect(LETDOWN_MIN_PROJECTION).toBeLessThanOrEqual(21);
    expect(spot.letdowns.map((p) => p.id)).toEqual(["dud"]);
  });

  it("lists top scorers for every position, kickers included", () => {
    expect(spot.byPosition.K.map((p) => p.id)).toEqual(["kick"]);
    expect(spot.byPosition.TE).toEqual([]);
  });
});

describe("gradeWeeks", () => {
  const players = new Map([ref("a", "WR"), ref("b", "RB")].map((r) => [r.id, r]));
  const rows = [row("a", 1, "WR", 12), row("a", 2, "WR", 8), row("b", 1, "RB", 15), row("b", 3, "RB", 30)];

  it("grades a week only when a projection above zero was published and the player played", () => {
    const projected = new Map([
      ["a|1", 10],
      ["a|2", 10],
      // No row for week 2 for b: he did not play, so nothing is graded.
      ["b|2", 14],
      // A zero projection is not a projection.
      ["b|1", 0],
    ]);
    const graded = gradeWeeks(rows, PPR, players, projected, 3);
    expect(graded.map((g) => `${g.playerId}|${g.week}`)).toEqual(["a|1", "a|2"]);
  });

  it("stops at the week it was told to", () => {
    const projected = new Map([["b|3", 12]]);
    expect(gradeWeeks(rows, PPR, players, projected, 2)).toEqual([]);
    expect(gradeWeeks(rows, PPR, players, projected, 3)).toHaveLength(1);
  });
});

describe("buildProjectionReport", () => {
  const players = new Map([ref("up", "WR"), ref("down", "WR"), ref("qb", "QB")].map((r) => [r.id, r]));
  const g = (playerId: string, week: number, position: SeasonPosition, projected: number, actual: number): GradedWeek => ({
    playerId,
    week,
    position,
    projected,
    actual,
  });
  const graded = [
    g("up", 1, "WR", 10, 14),
    g("up", 2, "WR", 10, 12),
    g("down", 1, "WR", 12, 4),
    g("down", 2, "WR", 12, 6),
    g("qb", 1, "QB", 20, 20),
  ];
  const report = buildProjectionReport(graded, players, "Sleeper");

  it("names the engine it graded", () => {
    expect(report.sourceName).toBe("Sleeper");
  });

  it("counts meeting the projection as a beat, the scoreboard's rule", () => {
    const qb = report.season.find((s) => s.position === "QB");
    expect(qb?.beatRate).toBe(1);
    expect(qb?.averageMiss).toBe(0);
  });

  it("reports the pooled row first with the beat rate, the miss and the lean", () => {
    const all = report.season[0];
    expect(all.position).toBe("ALL");
    expect(all.graded).toBe(5);
    expect(all.beatRate).toBe(0.6);
    // |4| + |2| + |-8| + |-6| + |0| = 20 over 5.
    expect(all.averageMiss).toBe(4);
    // 4 + 2 - 8 - 6 + 0 = -8 over 5.
    expect(all.lean).toBe(-1.6);
  });

  it("gives a position nobody was graded at nulls, not zeros", () => {
    const te = report.season.find((s) => s.position === "TE");
    expect(te).toEqual({ position: "TE", graded: 0, beatRate: null, averageMiss: null, lean: null });
  });

  it("breaks the beat rate out by week", () => {
    expect(report.byWeek).toEqual([
      { week: 1, graded: 3, beatRate: 0.67 },
      { week: 2, graded: 2, beatRate: 0.5 },
    ]);
  });

  it("lists who beat the number most often and who least", () => {
    expect(report.mostReliable[0].id).toBe("up");
    expect(report.leastReliable[0].id).toBe("down");
    expect(report.leastReliable[0].averageDiff).toBe(-7);
  });
});

describe("statLine, the parts a position is not known for", () => {
  it("keeps a receiver's pass on a trick play", () => {
    expect(statLine("WR", { rec: 3, rec_tgt: 4, rec_yd: 41, pass_att: 1, pass_cmp: 1, pass_yd: 22, pass_td: 1 })).toBe(
      "3 catches on 4 targets, 41 receiving yards; 1 of 1, 22 passing yards, 1 TD",
    );
  });

  it("keeps a quarterback's catch", () => {
    expect(statLine("QB", { pass_att: 30, pass_cmp: 20, pass_yd: 250, rec: 1, rec_tgt: 1, rec_yd: 12, rec_td: 1 })).toBe(
      "20 of 30, 250 passing yards; 1 catch on 1 target, 12 receiving yards, 1 TD",
    );
  });
});
