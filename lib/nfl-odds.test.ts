import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseHomeSpread,
  impliedTotals,
  normalizeEspnTeam,
  getEspnScoreboard,
} from "./nfl-odds";
import { NFL_TEAMS, NFL_TEAM_CODES } from "./nfl-teams";

describe("parseHomeSpread", () => {
  it("reads a home-favoured line: SEA -3.5, SEA is home", () => {
    expect(parseHomeSpread("SEA -3.5", -3.5, "SEA", "NE")).toBe(-3.5);
  });

  it("reads an away-favoured line: SEA -3.5, SEA is away and NE is home", () => {
    expect(parseHomeSpread("SEA -3.5", -3.5, "NE", "SEA")).toBe(3.5);
  });

  it("reads a pick-em line as zero regardless of team", () => {
    expect(parseHomeSpread("PK", 0, "SEA", "NE")).toBe(0);
    expect(parseHomeSpread("EVEN", 0, "SEA", "NE")).toBe(0);
  });

  it("falls back to the favorite hints when details cannot be parsed", () => {
    expect(
      parseHomeSpread("garbled", -3.5, "SEA", "NE", { homeFavorite: true, awayFavorite: false }),
    ).toBe(-3.5);
    expect(
      parseHomeSpread("garbled", -3.5, "SEA", "NE", { homeFavorite: false, awayFavorite: true }),
    ).toBe(3.5);
  });

  it("stores null rather than guessing when nothing resolves the sign", () => {
    expect(parseHomeSpread("garbled", -3.5, "SEA", "NE")).toBeNull();
    expect(parseHomeSpread(null, null, "SEA", "NE")).toBeNull();
    expect(parseHomeSpread(undefined, undefined, "SEA", "NE", {})).toBeNull();
  });

  it("resolves through the WSH/WAS alias on either side of the line", () => {
    expect(parseHomeSpread("WSH -1.5", -1.5, "WAS", "PHI")).toBe(-1.5);
    expect(parseHomeSpread("WSH -1.5", -1.5, "PHI", "WAS")).toBe(1.5);
  });
});

describe("impliedTotals", () => {
  it("splits a home-favoured game", () => {
    // 44.5 total, SEA (home) favoured by 3.5.
    expect(impliedTotals(44.5, -3.5)).toEqual({ home: 24, away: 20.5 });
  });

  it("splits an away-favoured game", () => {
    expect(impliedTotals(44.5, 3.5)).toEqual({ home: 20.5, away: 24 });
  });

  it("splits a pick-em game evenly", () => {
    expect(impliedTotals(42, 0)).toEqual({ home: 21, away: 21 });
  });

  it("never returns a confident half of nothing", () => {
    expect(impliedTotals(null, -3.5)).toEqual({ home: null, away: null });
    expect(impliedTotals(44.5, null)).toEqual({ home: null, away: null });
    expect(impliedTotals(null, null)).toEqual({ home: null, away: null });
  });
});

describe("normalizeEspnTeam", () => {
  it("maps Washington from ESPN's WSH to our WAS", () => {
    expect(normalizeEspnTeam("WSH")).toBe("WAS");
    expect(normalizeEspnTeam("wsh")).toBe("WAS");
  });

  it("passes every other code through unchanged", () => {
    expect(normalizeEspnTeam("SEA")).toBe("SEA");
    expect(normalizeEspnTeam("kc")).toBe("KC");
  });

  it("maps ESPN's full 32-team set onto exactly our 32 codes", () => {
    // ESPN's abbreviations match nfl_teams for every team except Washington.
    const espnAbbreviations = NFL_TEAMS.map((t) => (t.code === "WAS" ? "WSH" : t.code));
    expect(espnAbbreviations).toHaveLength(32);

    const mapped = new Set(espnAbbreviations.map(normalizeEspnTeam));
    expect(mapped).toEqual(NFL_TEAM_CODES);
    expect(mapped.size).toBe(32);
  });
});

describe("getEspnScoreboard", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  it("returns null when the request fails, never an empty array", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: "throttled" }));
    const result = await getEspnScoreboard(2026, 1, "regular");
    expect(result).toBeNull();
  });

  it("returns null when fetch itself throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await getEspnScoreboard(2026, 1, "regular");
    expect(result).toBeNull();
  });

  it("returns [] when ESPN answers with a genuinely empty slate", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { events: [] }));
    const result = await getEspnScoreboard(2026, 22, "post");
    expect(result).toEqual([]);
  });

  it("parses a game with odds into a normalised row", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        events: [
          {
            shortName: "NE @ SEA",
            date: "2026-09-10T00:20Z",
            competitions: [
              {
                competitors: [
                  { homeAway: "home", team: { abbreviation: "SEA" } },
                  { homeAway: "away", team: { abbreviation: "NE" } },
                ],
                odds: [
                  {
                    provider: { name: "DraftKings" },
                    details: "SEA -3.5",
                    overUnder: 44.5,
                    spread: -3.5,
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const result = await getEspnScoreboard(2026, 1, "regular");
    expect(result).toEqual([
      {
        season: 2026,
        seasonType: "regular",
        week: 1,
        homeTeam: "SEA",
        awayTeam: "NE",
        kickoffAt: "2026-09-10T00:20Z",
        gameTotal: 44.5,
        homeSpread: -3.5,
        provider: "DraftKings",
        raw: result?.[0]?.raw,
      },
    ]);
  });

  it("keeps a game with no odds as a real row with null total and spread", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        events: [
          {
            shortName: "NE @ SEA",
            date: "2026-09-10T00:20Z",
            competitions: [
              {
                competitors: [
                  { homeAway: "home", team: { abbreviation: "SEA" } },
                  { homeAway: "away", team: { abbreviation: "NE" } },
                ],
                // odds absent entirely, as ESPN sends on a completed game.
              },
            ],
          },
        ],
      }),
    );

    const result = await getEspnScoreboard(2026, 1, "regular");
    expect(result).toHaveLength(1);
    expect(result?.[0]?.gameTotal).toBeNull();
    expect(result?.[0]?.homeSpread).toBeNull();
    expect(result?.[0]?.provider).toBeNull();
  });

  it("maps Washington's WSH to WAS in the parsed row", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        events: [
          {
            shortName: "PHI @ WSH",
            date: "2026-09-14T17:00Z",
            competitions: [
              {
                competitors: [
                  { homeAway: "home", team: { abbreviation: "WSH" } },
                  { homeAway: "away", team: { abbreviation: "PHI" } },
                ],
                odds: [{ provider: { name: "ESPN BET" }, details: "PHI -2.5", overUnder: 47 }],
              },
            ],
          },
        ],
      }),
    );

    const result = await getEspnScoreboard(2026, 2, "regular");
    expect(result?.[0]?.homeTeam).toBe("WAS");
    expect(result?.[0]?.awayTeam).toBe("PHI");
    expect(result?.[0]?.homeSpread).toBe(2.5);
  });
});
