/**
 * Coverage for lib/nfl-game-environment.ts.
 *
 * The two things worth holding: the AWAY side's spread is the negation of the
 * stored home spread (a sign error here shows a favourite as an underdog on
 * every road team in the league), and a team with no published line is
 * UNRANKED rather than ranked last.
 */

import { describe, it, expect } from "vitest";
import {
  buildEnvironmentMap,
  describeEnvironment,
  describeSpread,
  environmentTier,
  weekAverageImpliedTotal,
  type OddsRow,
} from "./nfl-game-environment";

function row(overrides: Partial<OddsRow> = {}): OddsRow {
  return {
    home_team: "KC",
    away_team: "BUF",
    game_total: 48,
    home_spread: -3,
    home_implied_total: 25.5,
    away_implied_total: 22.5,
    kickoff_at: "2026-09-13T17:00:00.000Z",
    provider: "ESPN BET",
    ...overrides,
  };
}

describe("buildEnvironmentMap", () => {
  it("produces one entry per team from one row", () => {
    const map = buildEnvironmentMap([row()]);
    expect(map.size).toBe(2);
    expect(map.get("KC")?.opponent).toBe("BUF");
    expect(map.get("BUF")?.opponent).toBe("KC");
  });

  it("marks the home side home and the away side away", () => {
    const map = buildEnvironmentMap([row()]);
    expect(map.get("KC")?.isHome).toBe(true);
    expect(map.get("BUF")?.isHome).toBe(false);
  });

  it("negates the spread for the away side", () => {
    const map = buildEnvironmentMap([row({ home_spread: -3.5 })]);
    expect(map.get("KC")?.spread).toBe(-3.5);
    expect(map.get("BUF")?.spread).toBe(3.5);
  });

  it("keeps a null spread null on both sides rather than turning it into zero", () => {
    const map = buildEnvironmentMap([row({ home_spread: null })]);
    expect(map.get("KC")?.spread).toBeNull();
    expect(map.get("BUF")?.spread).toBeNull();
  });

  it("carries each side's own implied total", () => {
    const map = buildEnvironmentMap([row()]);
    expect(map.get("KC")?.impliedTotal).toBe(25.5);
    expect(map.get("BUF")?.impliedTotal).toBe(22.5);
  });

  it("uppercases and trims the stored codes", () => {
    const map = buildEnvironmentMap([row({ home_team: " kc ", away_team: "buf" })]);
    expect(map.has("KC")).toBe(true);
    expect(map.has("BUF")).toBe(true);
  });

  it("ranks by implied total, 1 being the highest", () => {
    const map = buildEnvironmentMap([
      row({ home_team: "KC", away_team: "BUF", home_implied_total: 25.5, away_implied_total: 22.5 }),
      row({ home_team: "SF", away_team: "SEA", home_implied_total: 28, away_implied_total: 17 }),
    ]);
    expect(map.get("SF")?.impliedRank).toBe(1);
    expect(map.get("KC")?.impliedRank).toBe(2);
    expect(map.get("BUF")?.impliedRank).toBe(3);
    expect(map.get("SEA")?.impliedRank).toBe(4);
    expect(map.get("SF")?.rankedTeams).toBe(4);
  });

  it("leaves a team with no implied total unranked rather than last", () => {
    const map = buildEnvironmentMap([
      row({ home_team: "KC", away_team: "BUF", home_implied_total: 25.5, away_implied_total: 22.5 }),
      row({
        home_team: "SF",
        away_team: "SEA",
        game_total: null,
        home_spread: null,
        home_implied_total: null,
        away_implied_total: null,
      }),
    ]);
    expect(map.get("SF")?.impliedRank).toBeNull();
    expect(map.get("SEA")?.impliedRank).toBeNull();
    // And the ranked count reports only the two that could be ranked.
    expect(map.get("KC")?.rankedTeams).toBe(2);
  });

  it("skips a row missing a team code instead of creating a blank entry", () => {
    const map = buildEnvironmentMap([row({ home_team: "", away_team: "BUF" })]);
    expect(map.size).toBe(0);
  });

  it("keeps the first row when a team somehow appears twice", () => {
    const map = buildEnvironmentMap([
      row({ home_team: "KC", away_team: "BUF", home_implied_total: 25.5 }),
      row({ home_team: "KC", away_team: "DEN", home_implied_total: 19 }),
    ]);
    expect(map.get("KC")?.opponent).toBe("BUF");
    expect(map.get("KC")?.impliedTotal).toBe(25.5);
  });
});

describe("weekAverageImpliedTotal", () => {
  it("averages only the teams that have a total", () => {
    const map = buildEnvironmentMap([
      row({ home_team: "KC", away_team: "BUF", home_implied_total: 26, away_implied_total: 22 }),
      row({
        home_team: "SF",
        away_team: "SEA",
        home_implied_total: null,
        away_implied_total: null,
      }),
    ]);
    expect(weekAverageImpliedTotal(map)).toBe(24);
  });

  it("returns null when nothing is published", () => {
    expect(weekAverageImpliedTotal(new Map())).toBeNull();
  });
});

describe("environmentTier", () => {
  it("reads high, neutral and low against the week's own average", () => {
    expect(environmentTier(27, 23)).toBe("high");
    expect(environmentTier(23, 23)).toBe("neutral");
    expect(environmentTier(19, 23)).toBe("low");
  });

  it("does not promote a difference inside the margin", () => {
    expect(environmentTier(25, 23)).toBe("neutral");
    expect(environmentTier(21, 23)).toBe("neutral");
  });

  it("has no opinion without a total or without an average", () => {
    expect(environmentTier(null, 23)).toBeNull();
    expect(environmentTier(25, null)).toBeNull();
  });
});

describe("describeSpread", () => {
  it("names the favourite, the underdog and the pick em", () => {
    expect(describeSpread(-3.5)).toBe("Favoured by 3.5");
    expect(describeSpread(3.5)).toBe("Underdog by 3.5");
    expect(describeSpread(0)).toBe("Even game");
  });

  it("says nothing without a spread", () => {
    expect(describeSpread(null)).toBeNull();
  });
});

describe("describeEnvironment", () => {
  it("says the number and then what it means", () => {
    const map = buildEnvironmentMap([row()]);
    const text = describeEnvironment(map.get("KC") ?? null, 23);
    expect(text).toContain("25.5");
    expect(text).toContain("at home against BUF");
    expect(text).toContain("higher totals");
  });

  it("says the line is missing rather than inventing one", () => {
    const map = buildEnvironmentMap([
      row({ home_implied_total: null, away_implied_total: null, game_total: null }),
    ]);
    expect(describeEnvironment(map.get("BUF") ?? null, null)).toContain("No scoring line published");
  });

  it("says there is no game rather than nothing at all", () => {
    expect(describeEnvironment(null, 23)).toBe("No game found for this week.");
  });
});
