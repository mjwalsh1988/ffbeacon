import { describe, expect, it } from "vitest";
import { winProbability } from "@/lib/power-pulse/math";
import {
  ODDS_BANDS,
  ROSTER_WINDOWS,
  VARIANCE_EXAMPLE,
  binomialPmf,
  deadlineCall,
  expectedWins,
  oddsBand,
  oddsPercent,
  playoffOdds,
  swingByWeek,
  type OddsInput,
} from "./playoff-odds";

const LEAGUE = { teams: 12, playoffSpots: 6, seasonWeeks: 14 };

describe("binomialPmf", () => {
  it("sums to one", () => {
    const sum = binomialPmf(14, 0.37).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it("handles the edges", () => {
    expect(binomialPmf(3, 0)).toEqual([1, 0, 0, 0]);
    expect(binomialPmf(0, 0.5)).toEqual([1]);
  });
});

describe("playoffOdds", () => {
  it("gives an average team in a half-field league exactly even odds before a game is played", () => {
    expect(playoffOdds({ ...LEAGUE, weeksPlayed: 0, wins: 0, winChance: 0.5 })).toBeCloseTo(0.5, 10);
  });

  it("is certain when every team makes it", () => {
    expect(
      playoffOdds({ teams: 8, playoffSpots: 8, seasonWeeks: 14, weeksPlayed: 3, wins: 0, winChance: 0.1 }),
    ).toBeCloseTo(1, 10);
  });

  it("rises with wins and with weekly win chance", () => {
    const at = (wins: number, winChance: number) =>
      playoffOdds({ ...LEAGUE, weeksPlayed: 8, wins, winChance });
    for (let w = 0; w < 8; w++) expect(at(w + 1, 0.5)).toBeGreaterThan(at(w, 0.5));
    expect(at(4, 0.6)).toBeGreaterThan(at(4, 0.5));
    expect(at(4, 0.5)).toBeGreaterThan(at(4, 0.4));
  });

  it("backs the page's claim that a strong 3-3 team is better placed than a weak 4-2 team", () => {
    const weak42 = playoffOdds({ ...LEAGUE, weeksPlayed: 6, wins: 4, winChance: 0.4 });
    const strong33 = playoffOdds({ ...LEAGUE, weeksPlayed: 6, wins: 3, winChance: 0.65 });
    expect(strong33).toBeGreaterThan(weak42);
    expect(oddsPercent(weak42)).toBe(54);
    expect(oddsPercent(strong33)).toBe(78);
  });

  it("clamps impossible input rather than throwing", () => {
    const odds = playoffOdds({ ...LEAGUE, weeksPlayed: 99, wins: 200, winChance: 3 });
    expect(odds).toBeGreaterThanOrEqual(0);
    expect(odds).toBeLessThanOrEqual(1);
  });

  it("agrees with a seeded simulation of the same assumptions", () => {
    // Mulberry32: small, seeded, deterministic.
    let seed = 20260918;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const input: OddsInput = { ...LEAGUE, weeksPlayed: 7, wins: 4, winChance: 0.55 };
    const runs = 40000;
    let made = 0;
    for (let r = 0; r < runs; r++) {
      let mine = input.wins;
      for (let g = input.weeksPlayed; g < input.seasonWeeks; g++) if (rand() < input.winChance) mine++;
      const field: number[] = [];
      for (let t = 0; t < input.teams - 1; t++) {
        let w = 0;
        for (let g = 0; g < input.seasonWeeks; g++) if (rand() < 0.5) w++;
        field.push(w);
      }
      const above = field.filter((w) => w > mine).length;
      const level = field.filter((w) => w === mine).length;
      const place = above + Math.floor(rand() * (level + 1));
      if (place < input.playoffSpots) made++;
    }
    expect(Math.abs(made / runs - playoffOdds(input))).toBeLessThan(0.01);
  });
});

describe("expectedWins", () => {
  it("adds the remaining games at the weekly chance", () => {
    expect(expectedWins({ ...LEAGUE, weeksPlayed: 6, wins: 4, winChance: 0.4 })).toBeCloseTo(7.2, 10);
  });
});

describe("oddsPercent", () => {
  it("never rounds a live chance to a certainty", () => {
    expect(oddsPercent(0.001)).toBe(1);
    expect(oddsPercent(0.999)).toBe(99);
    expect(oddsPercent(0)).toBe(0);
    expect(oddsPercent(1)).toBe(100);
  });
});

describe("swingByWeek", () => {
  const rows = swingByWeek({ ...LEAGUE, winChance: 0.5 });

  it("starts every row at .500", () => {
    for (const r of rows) expect(r.winsBefore).toBe(r.lossesBefore);
  });

  it("backs the page's claim that one game is worth more the later it comes", () => {
    for (let i = 1; i < rows.length; i++) expect(rows[i].swing).toBeGreaterThan(rows[i - 1].swing);
    expect(Math.round(rows[0].swing * 100)).toBe(20);
    expect(Math.round(rows[rows.length - 1].swing * 100)).toBe(40);
  });
});

describe("deadlineCall", () => {
  it("answers every band and window with a plain ASCII reason", () => {
    const banned = /[–—‘’“”…· ]/;
    for (const b of ODDS_BANDS) {
      for (const w of ROSTER_WINDOWS) {
        const r = deadlineCall(b.key, w.key);
        expect(r.why.length).toBeGreaterThan(40);
        expect(banned.test(r.why), r.why).toBe(false);
      }
    }
  });

  it("puts band edges where the table says", () => {
    expect(oddsBand(0.09)).toBe("out");
    expect(oddsBand(0.1)).toBe("long-shot");
    expect(oddsBand(0.35)).toBe("bubble");
    expect(oddsBand(0.65)).toBe("likely");
    expect(oddsBand(0.9)).toBe("safe");
  });

  it("never tells a young dynasty bubble team to sell its youth", () => {
    expect(deadlineCall("bubble", "dynasty-young").call).toBe("hold");
  });
});

describe("VARIANCE_EXAMPLE", () => {
  const p = (o: { mean: number; sigma: number }) =>
    winProbability(o.mean, o.sigma, VARIANCE_EXAMPLE.opponentMean, VARIANCE_EXAMPLE.opponentSigma);

  it("backs the page's claim that the underdog gains from a streakier lineup", () => {
    const [steady, streaky] = VARIANCE_EXAMPLE.underdog;
    expect(p(streaky)).toBeGreaterThan(p(steady));
    expect(Math.round(p(steady) * 100)).toBe(31);
    expect(Math.round(p(streaky) * 100)).toBe(36);
  });

  it("and that the favorite gains from a steadier one", () => {
    const [steady, streaky] = VARIANCE_EXAMPLE.favorite;
    expect(p(steady)).toBeGreaterThan(p(streaky));
    expect(Math.round(p(steady) * 100)).toBe(69);
    expect(Math.round(p(streaky) * 100)).toBe(64);
  });
});
