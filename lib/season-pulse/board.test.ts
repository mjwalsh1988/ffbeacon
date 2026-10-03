import { describe, it, expect } from "vitest";
import {
  buildSeasonBoard,
  pointsFor,
  rankDescending,
  scoringFor,
  scoringSettingsOf,
  trimBoard,
} from "./board";
import type { PlayerRef, SeasonPosition, WeekStatRow } from "./types";

const PPR = scoringFor({ scoring_type: "ppr", te_premium_bonus: null });

function ref(id: string, position: SeasonPosition, team = "BUF"): PlayerRef {
  return { id, slug: id, name: `Player ${id}`, position, team, sleeperId: null };
}

function row(
  playerId: string,
  week: number,
  position: SeasonPosition,
  ppr: number,
  extra: Partial<WeekStatRow> = {},
): WeekStatRow {
  return {
    playerId,
    week,
    position,
    team: "BUF",
    opponent: "NE",
    ppr,
    half: ppr - 1,
    std: ppr - 2,
    snapPct: null,
    stats: {},
    ...extra,
  };
}

function board(rows: WeekStatRow[], refs: PlayerRef[], throughWeek = 3, lastCompletedWeek = 3, scoring = PPR) {
  return buildSeasonBoard({
    season: 2026,
    throughWeek,
    lastCompletedWeek,
    scoring,
    rows,
    players: new Map(refs.map((r) => [r.id, r])),
    computedAt: "2026-10-03T00:00:00.000Z",
  });
}

describe("rankDescending", () => {
  it("shares a rank on a tie and skips the next one, the way SQL rank() does", () => {
    // The rule rebuild_positional_finishes uses (migration 0298). A player
    // profile reads that table, so this page must rank the same way.
    expect(rankDescending([50, 40, 40, 30])).toEqual([1, 2, 2, 4]);
  });

  it("returns ranks in input order, not sorted order", () => {
    expect(rankDescending([10, 30, 20])).toEqual([3, 1, 2]);
  });

  it("handles an empty list", () => {
    expect(rankDescending([])).toEqual([]);
  });
});

describe("scoringFor", () => {
  it("maps a format's scoring type to its stored column", () => {
    expect(scoringFor({ scoring_type: "ppr", te_premium_bonus: null }).base).toBe("pts_ppr");
    expect(scoringFor({ scoring_type: "half_ppr", te_premium_bonus: null }).base).toBe("pts_half_ppr");
    expect(scoringFor({ scoring_type: "standard", te_premium_bonus: null }).base).toBe("pts_std");
  });

  it("carries a tight end premium into the label and the cache key", () => {
    const tep = scoringFor({ scoring_type: "ppr", te_premium_bonus: 0.5 });
    expect(tep.tePremium).toBe(0.5);
    expect(tep.label).toBe("PPR with TE premium");
    expect(tep.key).not.toBe(PPR.key);
    expect(scoringSettingsOf(tep)).toEqual({ rec: 1, bonus_rec_te: 0.5 });
  });
});

describe("pointsFor", () => {
  it("reads the column the scoring names", () => {
    const r = row("a", 1, "WR", 20);
    expect(pointsFor(r, PPR)).toBe(20);
    expect(pointsFor(r, scoringFor({ scoring_type: "half_ppr", te_premium_bonus: null }))).toBe(19);
    expect(pointsFor(r, scoringFor({ scoring_type: "standard", te_premium_bonus: null }))).toBe(18);
  });

  it("adds the premium to a tight end's receptions and to nobody else's", () => {
    const tep = scoringFor({ scoring_type: "ppr", te_premium_bonus: 0.5 });
    expect(pointsFor(row("te", 1, "TE", 12, { stats: { rec: 6 } }), tep)).toBe(15);
    expect(pointsFor(row("wr", 1, "WR", 12, { stats: { rec: 6 } }), tep)).toBe(12);
  });

  it("is null when the stored column is null, never zero", () => {
    expect(pointsFor(row("a", 1, "WR", 0, { ppr: null }), PPR)).toBeNull();
  });
});

describe("buildSeasonBoard", () => {
  it("ranks within a position by total points and leaves other positions alone", () => {
    const b = board(
      [row("wr1", 1, "WR", 30), row("wr2", 1, "WR", 10), row("wr2", 2, "WR", 25), row("rb1", 1, "RB", 5)],
      [ref("wr1", "WR"), ref("wr2", "WR"), ref("rb1", "RB")],
    );
    const byId = new Map(b.players.map((p) => [p.id, p]));
    expect(byId.get("wr2")?.total).toBe(35);
    expect(byId.get("wr2")?.rank).toBe(1);
    expect(byId.get("wr1")?.rank).toBe(2);
    expect(byId.get("rb1")?.rank).toBe(1);
    expect(b.rankedByPosition.WR).toBe(2);
    expect(b.rankedByPosition.QB).toBe(0);
  });

  it("keeps a week not played as null and out of games and the per-game figure", () => {
    const b = board([row("a", 1, "WR", 20), row("a", 3, "WR", 10)], [ref("a", "WR")]);
    const a = b.players[0];
    expect(a.weeks).toEqual([20, null, 10]);
    expect(a.games).toBe(2);
    expect(a.perGame).toBe(15);
    expect(a.best).toBe(20);
    expect(a.worst).toBe(10);
  });

  it("shares a rank between tied totals", () => {
    const b = board(
      [row("a", 1, "QB", 20), row("b", 1, "QB", 20), row("c", 1, "QB", 5)],
      [ref("a", "QB"), ref("b", "QB"), ref("c", "QB")],
    );
    expect(b.players.map((p) => p.rank)).toEqual([1, 1, 3]);
  });

  it("ranks per game only among players who played at least half the completed weeks", () => {
    // Four completed weeks: two games qualify, one does not.
    const b = board(
      [row("one-game", 1, "RB", 40), row("steady", 1, "RB", 20), row("steady", 2, "RB", 20)],
      [ref("one-game", "RB"), ref("steady", "RB")],
      4,
      4,
    );
    const byId = new Map(b.players.map((p) => [p.id, p]));
    expect(byId.get("one-game")?.perGame).toBe(40);
    expect(byId.get("one-game")?.perGameRank).toBeNull();
    expect(byId.get("steady")?.perGameRank).toBe(1);
  });

  it("counts a week inside the starting range as a starter week", () => {
    // Thirteen quarterbacks in week 1: the thirteenth is outside the top 12.
    const rows = Array.from({ length: 13 }, (_, i) => row(`qb${i}`, 1, "QB", 30 - i));
    const refs = Array.from({ length: 13 }, (_, i) => ref(`qb${i}`, "QB"));
    const b = board(rows, refs, 1, 1);
    const byId = new Map(b.players.map((p) => [p.id, p]));
    expect(byId.get("qb11")?.weekRanks).toEqual([12]);
    expect(byId.get("qb11")?.starterWeeks).toBe(1);
    expect(byId.get("qb12")?.starterWeeks).toBe(0);
  });

  it("computes target share from the team's targets that week", () => {
    const b = board(
      [
        row("a", 1, "WR", 20, { stats: { rec_tgt: 10 } }),
        row("b", 1, "WR", 10, { stats: { rec_tgt: 30 } }),
        row("c", 1, "WR", 5, { team: "NE", stats: { rec_tgt: 8 } }),
      ],
      [ref("a", "WR"), ref("b", "WR"), ref("c", "WR", "NE")],
      1,
      1,
    );
    const byId = new Map(b.players.map((p) => [p.id, p]));
    expect(byId.get("a")?.targetShare).toBe(25);
    expect(byId.get("b")?.targetShare).toBe(75);
    expect(byId.get("c")?.targetShare).toBe(100);
  });

  it("reports snap share as a percentage and null when never recorded", () => {
    const b = board(
      [row("a", 1, "WR", 20, { snapPct: 0.8 }), row("a", 2, "WR", 20, { snapPct: 0.9 }), row("k", 1, "K", 9)],
      [ref("a", "WR"), ref("k", "K")],
    );
    const byId = new Map(b.players.map((p) => [p.id, p]));
    expect(byId.get("a")?.snapPct).toBe(85);
    expect(byId.get("k")?.snapPct).toBeNull();
  });

  it("shows the team a player most recently played for", () => {
    const b = board(
      [row("a", 1, "WR", 10, { team: "NYJ" }), row("a", 2, "WR", 10, { team: "DAL" })],
      [ref("a", "WR", "DAL")],
    );
    expect(b.players[0].team).toBe("DAL");
  });

  it("drops a row whose player is unknown rather than inventing a name", () => {
    expect(board([row("ghost", 1, "WR", 10)], []).players).toEqual([]);
  });

  it("reorders tight ends under a premium", () => {
    const tep = scoringFor({ scoring_type: "ppr", te_premium_bonus: 0.5 });
    const rows = [
      row("yards", 1, "TE", 16, { stats: { rec: 2 } }),
      row("catches", 1, "TE", 15, { stats: { rec: 10 } }),
    ];
    const refs = [ref("yards", "TE"), ref("catches", "TE")];
    expect(board(rows, refs, 1, 1).players[0].id).toBe("yards");
    expect(board(rows, refs, 1, 1, tep).players[0].id).toBe("catches");
  });
});

describe("trimBoard", () => {
  it("keeps the first N at each position and nothing else", () => {
    const rows = [row("a", 1, "WR", 30), row("b", 1, "WR", 20), row("c", 1, "WR", 10), row("q", 1, "QB", 5)];
    const b = board(rows, [ref("a", "WR"), ref("b", "WR"), ref("c", "WR"), ref("q", "QB")], 1, 1);
    const trimmed = trimBoard(b, { QB: 1, RB: 1, WR: 2, TE: 1, K: 1, DEF: 1 });
    expect(trimmed.players.map((p) => p.id)).toEqual(["q", "a", "b"]);
    // The count of everyone ranked survives the trim, so "WR2 of 3" stays true.
    expect(trimmed.rankedByPosition.WR).toBe(3);
  });
});

describe("the live week", () => {
  it("counts toward points and games but has no finish and is never a starter week", () => {
    // Week 2 is still being played: only this one running back has a line.
    const b = board([row("rb", 1, "RB", 4), row("rb", 2, "RB", 30)], [ref("rb", "RB")], 2, 1);
    const rb = b.players[0];
    expect(rb.total).toBe(34);
    expect(rb.games).toBe(2);
    expect(rb.weekRanks).toEqual([1, null]);
    // One starter week, from week 1. Ranking him against nobody in week 2
    // would have made it two.
    expect(rb.starterWeeks).toBe(1);
  });
});
