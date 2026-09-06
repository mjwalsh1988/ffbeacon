import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sleeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sleeper")>();
  return {
    ...actual,
    getSleeperUser: vi.fn(),
    getSleeperLeaguesOrNull: vi.fn(),
  };
});

import { getSleeperLeaguesOrNull, getSleeperUser, type SleeperLeague } from "@/lib/sleeper";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import {
  HANDLE_PATTERN,
  discoverLeagueSeasons,
  isValidSleeperHandle,
  resolveManagerHandle,
  selectLeagueSeasons,
  type DiscoveredLeagueSeason,
} from "./discover";

const mockGetSleeperUser = vi.mocked(getSleeperUser);
const mockGetSleeperLeagues = vi.mocked(getSleeperLeaguesOrNull);

beforeEach(() => {
  mockGetSleeperUser.mockReset();
  mockGetSleeperLeagues.mockReset();
});

function league(overrides: Partial<SleeperLeague> = {}): SleeperLeague {
  return {
    league_id: "league-1",
    name: "Test League",
    season: "2026",
    sport: "nfl",
    status: "in_season",
    total_rosters: 12,
    settings: { type: 0, best_ball: 0 },
    previous_league_id: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* isValidSleeperHandle                                                       */
/* -------------------------------------------------------------------------- */

describe("HANDLE_PATTERN / isValidSleeperHandle", () => {
  it("accepts a real handle shape", () => {
    expect(isValidSleeperHandle("test_user123")).toBe(true);
    expect(HANDLE_PATTERN.test("test_user123")).toBe(true);
  });

  it("rejects uppercase", () => {
    expect(isValidSleeperHandle("TestUser")).toBe(false);
  });

  it("rejects spaces", () => {
    expect(isValidSleeperHandle("test user")).toBe(false);
  });

  it("rejects a path traversal attempt", () => {
    expect(isValidSleeperHandle("../../etc/passwd")).toBe(false);
  });

  it("rejects an over-length string", () => {
    expect(isValidSleeperHandle("a".repeat(33))).toBe(false);
  });

  it("accepts the 32-character boundary", () => {
    expect(isValidSleeperHandle("a".repeat(32))).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidSleeperHandle("")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* resolveManagerHandle                                                       */
/* -------------------------------------------------------------------------- */

describe("resolveManagerHandle", () => {
  const invalidHandles = [
    ["uppercase", "TestUser"],
    ["spaces", "test user"],
    ["path traversal", "../../etc/passwd"],
    ["over-length", "a".repeat(33)],
    ["empty", ""],
  ] as const;

  it.each(invalidHandles)("never calls fetch for an invalid handle (%s)", async (_label, raw) => {
    const result = await resolveManagerHandle(raw);
    expect(result).toBeNull();
    expect(mockGetSleeperUser).not.toHaveBeenCalled();
  });

  it("resolves a valid handle against Sleeper", async () => {
    mockGetSleeperUser.mockResolvedValue({
      user_id: "u1",
      username: "testuser",
      display_name: "Test User",
      avatar: "abc123",
    });

    const result = await resolveManagerHandle("testuser");

    expect(result).toEqual({
      sleeperUserId: "u1",
      handle: "testuser",
      avatarUrl: "https://sleepercdn.com/avatars/abc123",
    });
  });

  it("returns null avatarUrl when Sleeper has none on file", async () => {
    mockGetSleeperUser.mockResolvedValue({
      user_id: "u1",
      username: "testuser",
      display_name: "Test User",
      avatar: null,
    });

    const result = await resolveManagerHandle("testuser");
    expect(result?.avatarUrl).toBeNull();
  });

  it("returns null for a handle Sleeper does not recognize", async () => {
    mockGetSleeperUser.mockResolvedValue(null);
    const result = await resolveManagerHandle("nobody_here");
    expect(result).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* selectLeagueSeasons                                                        */
/* -------------------------------------------------------------------------- */

describe("selectLeagueSeasons", () => {
  function ls(season: number, id: string): DiscoveredLeagueSeason {
    return {
      sleeperLeagueId: id,
      season,
      leagueName: null,
      category: "dynasty",
      previousLeagueId: null,
    };
  }

  function settingsWith(overrides: { maxLeaguesPerRun?: number; maxLeaguesPerSeason?: number }) {
    return {
      ...DEFAULT_MANAGER_PULSE_SETTINGS,
      capture: { ...DEFAULT_MANAGER_PULSE_SETTINGS.capture, ...overrides },
    };
  }

  it("keeps the most recent seasons first and reports the dropped count", () => {
    const found = [
      ls(2023, "a"),
      ls(2023, "b"),
      ls(2024, "c"),
      ls(2024, "d"),
      ls(2025, "e"),
    ];
    const settings = settingsWith({ maxLeaguesPerRun: 3, maxLeaguesPerSeason: 10 });

    const { kept, skipped } = selectLeagueSeasons(found, settings);

    expect(kept.map((l) => l.sleeperLeagueId)).toEqual(["e", "c", "d"]);
    expect(skipped).toBe(2);
  });

  it("caps leagues within a single season", () => {
    const found = [ls(2026, "a"), ls(2026, "b"), ls(2026, "c")];
    const settings = settingsWith({ maxLeaguesPerRun: 100, maxLeaguesPerSeason: 1 });

    const { kept, skipped } = selectLeagueSeasons(found, settings);

    expect(kept).toHaveLength(1);
    expect(kept[0].sleeperLeagueId).toBe("a");
    expect(skipped).toBe(2);
  });

  it("keeps everything and skips nothing when under both caps", () => {
    const found = [ls(2025, "a"), ls(2026, "b")];
    const settings = settingsWith({ maxLeaguesPerRun: 60, maxLeaguesPerSeason: 40 });

    const { kept, skipped } = selectLeagueSeasons(found, settings);

    expect(kept).toHaveLength(2);
    expect(skipped).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* discoverLeagueSeasons                                                      */
/* -------------------------------------------------------------------------- */

describe("discoverLeagueSeasons", () => {
  it("excludes best ball leagues when includeBestBall is false", async () => {
    mockGetSleeperLeagues.mockImplementation(async (_userId, season) => {
      if (season !== "2026") return [];
      return [
        league({ league_id: "dynasty-1", settings: { type: 2, best_ball: 0 } }),
        league({ league_id: "best-ball-1", settings: { type: 2, best_ball: 1 } }),
      ];
    });

    const settings = {
      ...DEFAULT_MANAGER_PULSE_SETTINGS,
      capture: { ...DEFAULT_MANAGER_PULSE_SETTINGS.capture, includeBestBall: false },
    };

    const { leagueSeasons } = await discoverLeagueSeasons({
      sleeperUserId: "u1",
      seasonFrom: 2026,
      seasonTo: 2026,
      settings,
    });

    expect(leagueSeasons.map((l) => l.sleeperLeagueId)).toEqual(["dynasty-1"]);
  });

  it("keeps best ball leagues when includeBestBall is true", async () => {
    mockGetSleeperLeagues.mockImplementation(async (_userId, season) => {
      if (season !== "2026") return [];
      return [league({ league_id: "best-ball-1", settings: { type: 0, best_ball: 1 } })];
    });

    const { leagueSeasons } = await discoverLeagueSeasons({
      sleeperUserId: "u1",
      seasonFrom: 2026,
      seasonTo: 2026,
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    });

    expect(leagueSeasons.map((l) => l.category)).toEqual(["best-ball-redraft"]);
  });

  it("bounds season fetch concurrency to 3", async () => {
    let active = 0;
    let maxActive = 0;
    mockGetSleeperLeagues.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return [];
    });

    await discoverLeagueSeasons({
      sleeperUserId: "u1",
      seasonFrom: 2020,
      seasonTo: 2026,
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    });

    // 7 seasons requested; bounded concurrency means never more than 3 in
    // flight at once, and with 7 items over a limit of 3 it should actually
    // reach 3 rather than degrading to sequential.
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("carries previousLeagueId through untouched, never using it to discover", async () => {
    mockGetSleeperLeagues.mockImplementation(async (_userId, season) => {
      if (season !== "2026") return [];
      return [league({ league_id: "a", previous_league_id: "old-league-id" })];
    });

    const { leagueSeasons } = await discoverLeagueSeasons({
      sleeperUserId: "u1",
      seasonFrom: 2026,
      seasonTo: 2026,
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    });

    expect(leagueSeasons[0].previousLeagueId).toBe("old-league-id");
    // Only the per-season user endpoint is ever called, never a lookup keyed
    // on the previous league id.
    expect(mockGetSleeperLeagues).toHaveBeenCalledWith("u1", "2026");
  });

  /*
   * F4/MPS-T008: a failed request is not the same fact as an empty season.
   * `getSleeperLeaguesOrNull` returns null when the REQUEST failed (a 429, a
   * timeout) and [] only when Sleeper genuinely answered with nothing. A
   * season that failed must be named back to the caller so it can refuse to
   * cache an undercounted report, rather than silently contributing zero
   * leagues indistinguishable from a season with none.
   */
  it("reports a failed season separately from an empty one, and still returns the rest", async () => {
    mockGetSleeperLeagues.mockImplementation(async (_userId, season) => {
      if (season === "2024") return null; // the request itself failed
      if (season === "2025") return []; // Sleeper answered: no leagues
      return [league({ league_id: `league-${season}`, season })];
    });

    const { leagueSeasons, failedSeasons } = await discoverLeagueSeasons({
      sleeperUserId: "u1",
      seasonFrom: 2024,
      seasonTo: 2026,
      settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    });

    expect(failedSeasons).toEqual([2024]);
    expect(leagueSeasons.map((l) => l.sleeperLeagueId)).toEqual(["league-2026"]);
  });
});
