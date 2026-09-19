import { describe, expect, it } from "vitest";
import { LUCK_PAIRINGS, LUCK_SCORES, buildLuckExample } from "./playoff-luck-example";

describe("the invented luck league", () => {
  const rows = buildLuckExample();
  const a = rows[0];
  const b = rows[1];

  it("is a real round robin: every team plays every other team exactly once", () => {
    const seen = new Set<string>();
    for (const games of LUCK_PAIRINGS) {
      const playing = games.flat();
      expect(new Set(playing).size).toBe(6);
      for (const [x, y] of games) seen.add([x, y].sort().join("-"));
    }
    expect(seen.size).toBe(15);
    for (const week of LUCK_SCORES) expect(week.length).toBe(6);
  });

  it("gives Team A and Team B the same points and opposite records, as the caption says", () => {
    expect(a.pointsFor).toBe(540);
    expect(b.pointsFor).toBe(540);
    expect(a.record).toEqual({ wins: 4, losses: 1, ties: 0 });
    expect(b.record).toEqual({ wins: 1, losses: 4, ties: 0 });
  });

  it("puts their all-play records much closer together than their real ones", () => {
    expect([a.allPlayWins, a.allPlayLosses]).toEqual([15, 10]);
    expect([b.allPlayWins, b.allPlayLosses]).toEqual([12, 13]);
    expect(a.luck).toBeCloseTo(0.8 - 0.6, 10);
    expect(b.luck).toBeCloseTo(0.2 - 0.48, 10);
    expect(a.luckRank).toBe(1);
    expect(b.luckRank).toBe(6);
  });

  it("backs the caption: Team A has the best all-play record, Team B sits in the middle", () => {
    const wins = rows.map((r) => r.allPlayWins).sort((x, y) => y - x);
    expect(a.allPlayWins).toBe(wins[0]);
    expect(wins.filter((w) => w > a.allPlayWins).length).toBe(0);
    expect(wins.filter((w) => w > b.allPlayWins).length).toBeGreaterThan(0);
    expect(wins.filter((w) => w < b.allPlayWins).length).toBeGreaterThan(0);
  });

  it("has no tied games, so the win and loss counts in the copy are exact", () => {
    for (const week of LUCK_PAIRINGS.keys()) {
      for (const [x, y] of LUCK_PAIRINGS[week]) {
        expect(LUCK_SCORES[week][x]).not.toBe(LUCK_SCORES[week][y]);
      }
    }
  });
});
