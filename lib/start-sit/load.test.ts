import { describe, it, expect } from "vitest";
import {
  normalizeStartSitSlugs,
  resolveBoardWeek,
  remainingWeeksFrom,
  parseStartCountParam,
  normalizeCandidatePosition,
  floorCeiling,
  detectOnBye,
  MIN_COMPLETE_SLATE_TEAMS,
} from "./load";
import { MAX_START_SIT_PLAYERS } from "./types";
import type { GameEnvironment } from "@/lib/nfl-game-environment";

describe("normalizeStartSitSlugs", () => {
  it("dedupes while preserving the reader's add order", () => {
    expect(normalizeStartSitSlugs(["b-player", "a-player", "b-player"])).toEqual([
      "b-player",
      "a-player",
    ]);
  });

  it("drops blank entries from a stray comma", () => {
    expect(normalizeStartSitSlugs(["a-player", "", "  ", "b-player"])).toEqual([
      "a-player",
      "b-player",
    ]);
  });

  it("caps at MAX_START_SIT_PLAYERS", () => {
    const slugs = Array.from({ length: MAX_START_SIT_PLAYERS + 5 }, (_, i) => `player-${i}`);
    const result = normalizeStartSitSlugs(slugs);
    expect(result).toHaveLength(MAX_START_SIT_PLAYERS);
    expect(result).toEqual(slugs.slice(0, MAX_START_SIT_PLAYERS));
  });

  it("trims whitespace around a slug", () => {
    expect(normalizeStartSitSlugs([" a-player ", "b-player"])).toEqual(["a-player", "b-player"]);
  });
});

describe("resolveBoardWeek", () => {
  it("falls back to the current week when the param is missing", () => {
    expect(resolveBoardWeek(undefined, 3)).toBe(3);
  });

  it("falls back to the current week when the param is unparseable", () => {
    expect(resolveBoardWeek("not-a-week", 3)).toBe(3);
  });

  it("accepts a week inside currentWeek..maxWeek", () => {
    expect(resolveBoardWeek("5", 3)).toBe(5);
  });

  it("refuses a past week and falls back to the current one", () => {
    expect(resolveBoardWeek("2", 3)).toBe(3);
  });

  it("refuses a week beyond the regular season", () => {
    expect(resolveBoardWeek("19", 3)).toBe(3);
  });

  it("reads the first entry of an array param", () => {
    expect(resolveBoardWeek(["6", "7"], 3)).toBe(6);
  });

  it("accepts the current week itself", () => {
    expect(resolveBoardWeek("3", 3)).toBe(3);
  });
});

describe("remainingWeeksFrom", () => {
  it("lists every week from currentWeek through 18", () => {
    expect(remainingWeeksFrom(16)).toEqual([16, 17, 18]);
  });

  it("is empty once the season has finished", () => {
    expect(remainingWeeksFrom(19)).toEqual([]);
  });

  it("respects a custom max week", () => {
    expect(remainingWeeksFrom(1, 3)).toEqual([1, 2, 3]);
  });
});

describe("parseStartCountParam", () => {
  it("defaults when the param is missing", () => {
    expect(parseStartCountParam(undefined)).toBe(1);
  });

  it("parses a valid integer", () => {
    expect(parseStartCountParam("2")).toBe(2);
  });

  it("defaults on an unparseable value", () => {
    expect(parseStartCountParam("abc")).toBe(1);
  });

  it("reads the first entry of an array param", () => {
    expect(parseStartCountParam(["3", "4"])).toBe(3);
  });
});

describe("normalizeCandidatePosition", () => {
  it("passes through each of the six evaluated positions", () => {
    for (const position of ["QB", "RB", "WR", "TE", "K", "DEF"]) {
      expect(normalizeCandidatePosition(position)).toBe(position);
    }
  });

  it("is case-insensitive", () => {
    expect(normalizeCandidatePosition("qb")).toBe("QB");
  });

  it("folds DST into DEF", () => {
    expect(normalizeCandidatePosition("DST")).toBe("DEF");
    expect(normalizeCandidatePosition("dst")).toBe("DEF");
  });

  it("refuses a position outside the six", () => {
    expect(normalizeCandidatePosition("LB")).toBeNull();
    expect(normalizeCandidatePosition("OL")).toBeNull();
  });
});

describe("floorCeiling", () => {
  it("computes floor as max(0, points - sigma) and ceiling as points + sigma", () => {
    expect(floorCeiling(12, 4)).toEqual({ floor: 8, ceiling: 16 });
  });

  it("clamps the floor at zero rather than going negative", () => {
    expect(floorCeiling(3, 10)).toEqual({ floor: 0, ceiling: 13 });
  });

  it("returns both null when points is null", () => {
    expect(floorCeiling(null, 4)).toEqual({ floor: null, ceiling: null });
  });

  it("returns both null when sigma is null", () => {
    expect(floorCeiling(12, null)).toEqual({ floor: null, ceiling: null });
  });
});

describe("detectOnBye", () => {
  function env(team: string): GameEnvironment {
    return {
      team,
      opponent: "XYZ",
      isHome: true,
      gameTotal: 45,
      spread: -2,
      impliedTotal: 23.5,
      impliedRank: 1,
      rankedTeams: 16,
      kickoffAt: null,
      provider: "espn",
    };
  }

  /** A game environment map naming `count` distinct teams, none of them ATL or NYJ. */
  function completeMap(count: number): Map<string, GameEnvironment> {
    const byTeam = new Map<string, GameEnvironment>();
    const pool = [
      "PHI", "DAL", "SEA", "SF", "GB", "MIN", "DET", "CHI", "BUF", "MIA",
      "NE", "NYG", "BAL", "PIT", "CIN", "CLE", "HOU", "IND", "JAX", "TEN",
      "DEN", "KC", "LAC", "LV", "ARI", "LAR", "TB", "CAR", "NO", "WAS",
    ];
    for (let i = 0; i < count; i += 1) {
      const team = pool[i];
      byTeam.set(team, env(team));
    }
    return byTeam;
  }

  it("is false for every player when the map is empty", () => {
    const byTeam = new Map<string, GameEnvironment>();
    expect(detectOnBye("NYJ", byTeam, null)).toBe(false);
    expect(detectOnBye("ATL", byTeam, null)).toBe(false);
  });

  it("is true for a complete slate, team absent, and no projected points", () => {
    const byTeam = completeMap(MIN_COMPLETE_SLATE_TEAMS);
    expect(byTeam.size).toBe(MIN_COMPLETE_SLATE_TEAMS);
    expect(detectOnBye("NYJ", byTeam, null)).toBe(true);
  });

  it("is false for a complete slate with the team absent but points present (mismatch guard)", () => {
    const byTeam = completeMap(MIN_COMPLETE_SLATE_TEAMS);
    expect(detectOnBye("NYJ", byTeam, 12.4)).toBe(false);
  });

  it("is false for a partial slate under the threshold, even with the team absent and points null", () => {
    const byTeam = completeMap(MIN_COMPLETE_SLATE_TEAMS - 1);
    expect(byTeam.size).toBeLessThan(MIN_COMPLETE_SLATE_TEAMS);
    expect(detectOnBye("NYJ", byTeam, null)).toBe(false);
  });

  it("is false for a team present in the week's game environment", () => {
    const byTeam = completeMap(MIN_COMPLETE_SLATE_TEAMS);
    byTeam.set("ATL", env("ATL"));
    expect(detectOnBye("ATL", byTeam, null)).toBe(false);
  });

  it("is case-insensitive on the team code", () => {
    const byTeam = completeMap(MIN_COMPLETE_SLATE_TEAMS);
    byTeam.set("ATL", env("ATL"));
    expect(detectOnBye("atl", byTeam, null)).toBe(false);
  });

  it("is false when the candidate has no team on file", () => {
    expect(detectOnBye(null, completeMap(MIN_COMPLETE_SLATE_TEAMS), null)).toBe(false);
  });
});
