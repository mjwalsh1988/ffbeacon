/**
 * Coverage for E8 (Power Pulse observability parity): the return-shape
 * classifier, the backoff and its bypasses, and the write ordering.
 *
 * The dependencies calculateLeaguePowerPulse calls (Sleeper, roster/player/
 * projection loads, the model itself) are mocked so a test can drive one
 * specific branch of the pipeline without assembling a full league. The
 * `leagues` and `league_power_pulse_cache` tables are the two the code under
 * test talks to directly, so those are a small hand-built stub that also
 * records call order, matching the pattern in lib/power-pulse/load.test.ts
 * and lib/league-power-rankings.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sleeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sleeper")>();
  return { ...actual, getNflState: vi.fn() };
});

vi.mock("@/lib/league-matchups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/league-matchups")>();
  return { ...actual, syncLeagueMatchups: vi.fn() };
});

vi.mock("@/lib/power-pulse/load", () => ({
  loadLeague: vi.fn(),
  loadRosters: vi.fn(),
  loadPlayers: vi.fn(),
  loadProjections: vi.fn(),
  loadAccuracy: vi.fn(),
  loadDefenseSplits: vi.fn(),
  loadSchedule: vi.fn(),
  loadCompletedResults: vi.fn(),
}));

vi.mock("@/lib/power-pulse/settings", () => ({
  loadPowerPulseSettings: vi.fn(),
}));

vi.mock("@/lib/power-pulse/engine", () => ({
  computePowerPulse: vi.fn(),
}));

import {
  classifyPowerPulseResult,
  powerPulseIsStale,
  refreshPowerPulse,
  POWER_PULSE_RETRY_MS,
  type PowerPulseResult,
} from "./league-power-pulse";
import { getNflState } from "@/lib/sleeper";
import { syncLeagueMatchups } from "@/lib/league-matchups";
import {
  loadLeague,
  loadRosters,
  loadPlayers,
  loadProjections,
  loadAccuracy,
  loadDefenseSplits,
  loadSchedule,
  loadCompletedResults,
} from "@/lib/power-pulse/load";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { computePowerPulse } from "@/lib/power-pulse/engine";
import type { PowerPulseTeamResult } from "@/lib/power-pulse/engine";

/* ---------------------------------------------------------------------- */
/* Fixtures                                                                */
/* ---------------------------------------------------------------------- */

const LEAGUE_ROW_ID = "league-row-1";

function fakeLeague(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: LEAGUE_ROW_ID,
    sleeperLeagueId: "sleeper-1",
    name: "Test League",
    season: 2026,
    status: "in_season",
    rosterPositions: [],
    scoringSettings: {},
    playoffTeams: 12,
    playoffWeekStart: 15,
    ...overrides,
  };
}

function fakeTeam(overrides: Partial<PowerPulseTeamResult> = {}): PowerPulseTeamResult {
  return {
    rosterRowId: "roster-1",
    sleeperRosterId: 1,
    teamName: "Team One",
    powerPulse: 80,
    pulseRank: 1,
    scorePoints: 80,
    scorePointsRank: 1,
    scoreSchedule: 50,
    scoreScheduleRank: 1,
    scoreDepth: 50,
    scoreDepthRank: 1,
    scoreForm: 50,
    scoreFormRank: 1,
    expectedPointsPerWeek: 110,
    expectedPointsStdev: 12,
    expectedWins: 8,
    projectedWins: 8,
    projectedLosses: 5,
    projectedTies: 0,
    playoffOdds: 0.6,
    byeOdds: 0.1,
    titleOdds: 0.15,
    lastPlaceOdds: 0.02,
    sosPoints: 100,
    sosRank: 5,
    lineupEfficiency: 0.9,
    lineupEfficiencyRank: 2,
    lineupPointsLost: 3.2,
    reliabilityScore: 0.7,
    reliabilityRank: 3,
    weekly: [],
    drivers: [],
    components: {
      positionPoints: {},
      positionRanks: {},
      starters: [],
      depthDropoffPct: 0,
      unfilledSlotRate: 0,
    },
    ...overrides,
  } as PowerPulseTeamResult;
}

/**
 * Minimal stand-in for the two tables refreshPowerPulse/calculateLeaguePowerPulse
 * touch directly. Records every operation in `calls`, in the order it happened,
 * so write-ordering assertions (E8-4) do not depend on inspecting timestamps.
 */
function makeFakeClient(opts: {
  leaguesRow?: Record<string, unknown> | null;
  cacheRow?: Record<string, unknown> | null;
} = {}) {
  const calls: string[] = [];
  const leagueUpdates: Array<Record<string, unknown>> = [];

  const leaguesBuilder = () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () =>
        Promise.resolve({ data: opts.leaguesRow ?? null, error: null }),
      update: (payload: Record<string, unknown>) => {
        calls.push(`leagues.update:${Object.keys(payload).sort().join(",")}`);
        leagueUpdates.push(payload);
        return {
          eq: () => Promise.resolve({ error: null }),
        };
      },
    };
    return builder;
  };

  const cacheBuilder = () => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () =>
        Promise.resolve({ data: opts.cacheRow ?? null, error: null }),
      upsert: () => {
        calls.push("cache.upsert");
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: () => ({
          eq: () => {
            calls.push("cache.delete");
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
    return builder;
  };

  const client = {
    from: (table: string) => {
      if (table === "leagues") return leaguesBuilder();
      if (table === "league_power_pulse_cache") return cacheBuilder();
      throw new Error(`unexpected table in test stub: ${table}`);
    },
  };

  return { client: client as never, calls, leagueUpdates };
}

/** Configure the mocked pipeline to reach a clean 'ok' result. */
function wireOkPipeline() {
  vi.mocked(loadLeague).mockResolvedValue(fakeLeague() as never);
  vi.mocked(getNflState).mockResolvedValue({
    week: 5,
    season_type: "regular",
    season: "2026",
  } as never);
  vi.mocked(loadPowerPulseSettings).mockResolvedValue({ modelVersion: "v1" } as never);
  vi.mocked(syncLeagueMatchups).mockResolvedValue({
    ok: true,
    weeksFetched: [5],
    rowsWritten: 2,
    failedWeeks: [],
    noScheduleYet: false,
  } as never);
  vi.mocked(loadRosters).mockResolvedValue([
    { id: "roster-1", playerSleeperIds: ["111"] } as never,
  ]);
  vi.mocked(loadPlayers).mockResolvedValue(
    new Map([["111", { playerId: "p1" } as never]]),
  );
  vi.mocked(loadProjections).mockResolvedValue([{ playerId: "p1" } as never]);
  vi.mocked(loadAccuracy).mockResolvedValue(new Map());
  vi.mocked(loadDefenseSplits).mockResolvedValue(new Map());
  vi.mocked(loadSchedule).mockResolvedValue({
    weeks: [{ week: 5, isFinal: false } as never],
    setLineups: new Map(),
  } as never);
  vi.mocked(loadCompletedResults).mockResolvedValue(new Map());
  vi.mocked(computePowerPulse).mockReturnValue([fakeTeam()]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------------- */
/* E8-1: the nine return shapes classify correctly                        */
/* ---------------------------------------------------------------------- */

describe("classifyPowerPulseResult", () => {
  const cases: Array<[string, PowerPulseResult, "ok" | "skipped" | "settled" | "error"]> = [
    ["ok, no skipped reason", { ok: true, teams: 10, season: 2026, currentWeek: 5 }, "ok"],
    [
      "incomplete schedule fetch",
      {
        ok: true,
        teams: 0,
        season: 2026,
        currentWeek: 5,
        skipped: "incomplete schedule fetch (weeks 5, 6 did not answer)",
      },
      "skipped",
    ],
    [
      "no rosters",
      { ok: true, teams: 0, season: 2026, currentWeek: 5, skipped: "no rosters" },
      "skipped",
    ],
    [
      "no teams scored",
      { ok: true, teams: 0, season: 2026, currentWeek: 5, skipped: "no teams scored" },
      "skipped",
    ],
    [
      "no weekly projections stored",
      {
        ok: true,
        teams: 0,
        season: 2026,
        currentWeek: 5,
        skipped: "no weekly projections stored for 2026 from week 5",
      },
      "skipped",
    ],
    [
      "no published schedule",
      { ok: true, teams: 0, season: 2026, currentWeek: 1, skipped: "no published schedule" },
      "settled",
    ],
    [
      "draft pending with empty rosters",
      {
        ok: true,
        teams: 0,
        season: 2026,
        currentWeek: 1,
        skipped: "draft pending with empty rosters",
      },
      "settled",
    ],
    [
      "no regular season games remaining",
      {
        ok: true,
        teams: 0,
        season: 2026,
        currentWeek: 17,
        skipped: "no regular season games remaining from week 17",
      },
      "settled",
    ],
    ["ok: false", { ok: false, error: "power pulse upsert failed: boom" }, "error"],
  ];

  for (const [label, result, expected] of cases) {
    it(`maps "${label}" to '${expected}'`, () => {
      expect(classifyPowerPulseResult(result).status).toBe(expected);
    });
  }

  it("degrades an unrecognised skipped reason to 'skipped' rather than 'settled'", () => {
    const result: PowerPulseResult = {
      ok: true,
      teams: 0,
      season: 2026,
      currentWeek: 5,
      skipped: "some brand new reason nobody classified yet",
    };
    expect(classifyPowerPulseResult(result).status).toBe("skipped");
  });

  it("carries the error message through as detail for 'error'", () => {
    const result: PowerPulseResult = { ok: false, error: "connection refused" };
    expect(classifyPowerPulseResult(result).detail).toBe("connection refused");
  });
});

/* ---------------------------------------------------------------------- */
/* Early return in powerPulseIsStale                                      */
/* ---------------------------------------------------------------------- */

describe("powerPulseIsStale backoff early return", () => {
  it("returns false for a backed-off 'skipped' league without calling getCurrentWeek or touching the cache table", async () => {
    const { client } = makeFakeClient({
      leaguesRow: {
        last_pulsed_at: null,
        power_pulse_status: "skipped",
        power_pulse_detail: "no rosters",
        power_pulse_attempted_at: new Date().toISOString(),
      },
    });
    const getCurrentWeek = vi.fn();

    // A client whose league_power_pulse_cache table throws if touched, so the
    // "before its existing queries" claim is falsifiable, not just described.
    const guardedClient = {
      from: (table: string) => {
        if (table === "league_power_pulse_cache") {
          throw new Error("cache table should not be queried when backed off");
        }
        return (client as { from: (t: string) => unknown }).from(table);
      },
    } as never;

    const stale = await powerPulseIsStale(
      guardedClient,
      LEAGUE_ROW_ID,
      2026,
      15,
      getCurrentWeek,
      "v1",
    );

    expect(stale).toBe(false);
    expect(getCurrentWeek).not.toHaveBeenCalled();
  });

  it("returns true (not backed off) for a null status, a normal first attempt", async () => {
    const { client } = makeFakeClient({
      leaguesRow: {
        last_pulsed_at: null,
        power_pulse_status: null,
        power_pulse_detail: null,
        power_pulse_attempted_at: null,
      },
      cacheRow: null,
    });
    const getCurrentWeek = vi.fn().mockResolvedValue(5);

    const stale = await powerPulseIsStale(client, LEAGUE_ROW_ID, 2026, 15, getCurrentWeek, "v1");
    expect(stale).toBe(true);
  });
});

/* ---------------------------------------------------------------------- */
/* E8-2: a backed-off league performs no Sleeper request and no roster load */
/* ---------------------------------------------------------------------- */

describe("refreshPowerPulse backoff (E8-2)", () => {
  it("performs no Sleeper request and no roster load for a backed-off 'skipped' league", async () => {
    wireOkPipeline();
    const { client } = makeFakeClient({
      leaguesRow: {
        last_pulsed_at: null,
        power_pulse_status: "skipped",
        power_pulse_detail: "no rosters",
        power_pulse_attempted_at: new Date().toISOString(), // just now: inside the window
      },
    });

    await refreshPowerPulse(client, LEAGUE_ROW_ID);

    expect(getNflState).not.toHaveBeenCalled();
    expect(syncLeagueMatchups).not.toHaveBeenCalled();
    expect(loadRosters).not.toHaveBeenCalled();
  });

  it("performs no Sleeper request and no roster load for a backed-off 'error' league", async () => {
    wireOkPipeline();
    const { client } = makeFakeClient({
      leaguesRow: {
        last_pulsed_at: null,
        power_pulse_status: "error",
        power_pulse_detail: "power pulse upsert failed: boom",
        power_pulse_attempted_at: new Date().toISOString(),
      },
    });

    await refreshPowerPulse(client, LEAGUE_ROW_ID);

    expect(getNflState).not.toHaveBeenCalled();
    expect(syncLeagueMatchups).not.toHaveBeenCalled();
    expect(loadRosters).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------- */
/* E8-3: last_pulsed_at bypass, present for skipped/error, absent for settled */
/* ---------------------------------------------------------------------- */

describe("refreshPowerPulse backoff bypass (E8-3)", () => {
  it("bypasses the backoff for 'skipped' when last_pulsed_at advanced since the attempt", async () => {
    wireOkPipeline();
    const attemptedAt = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    const lastPulsedAt = new Date().toISOString(); // just now: after the attempt
    const { client } = makeFakeClient({
      leaguesRow: {
        last_pulsed_at: lastPulsedAt,
        power_pulse_status: "skipped",
        power_pulse_detail: "no rosters",
        power_pulse_attempted_at: attemptedAt,
      },
    });

    await refreshPowerPulse(client, LEAGUE_ROW_ID);

    expect(syncLeagueMatchups).toHaveBeenCalledTimes(1);
  });

  it("bypasses the backoff for 'error' when last_pulsed_at advanced since the attempt", async () => {
    wireOkPipeline();
    const attemptedAt = new Date(Date.now() - 60_000).toISOString();
    const lastPulsedAt = new Date().toISOString();
    const { client } = makeFakeClient({
      leaguesRow: {
        last_pulsed_at: lastPulsedAt,
        power_pulse_status: "error",
        power_pulse_detail: "boom",
        power_pulse_attempted_at: attemptedAt,
      },
    });

    await refreshPowerPulse(client, LEAGUE_ROW_ID);

    expect(syncLeagueMatchups).toHaveBeenCalledTimes(1);
  });

  it("does NOT bypass the backoff for 'settled' when only last_pulsed_at advanced and the triple is unchanged", async () => {
    wireOkPipeline();
    const attemptedAt = new Date(Date.now() - 60_000).toISOString();
    const lastPulsedAt = new Date().toISOString(); // advanced, but settled ignores this clause
    const { client } = makeFakeClient({
      leaguesRow: {
        last_pulsed_at: lastPulsedAt,
        power_pulse_status: "settled",
        power_pulse_detail:
          "no regular season games remaining from week 5 [settled season=2026 week=5 playoffStart=15]",
        power_pulse_attempted_at: attemptedAt,
      },
    });

    await refreshPowerPulse(client, LEAGUE_ROW_ID);

    // getNflState resolves week=5 via resolveCurrentWeek, matching the stored
    // triple exactly, so the verdict cannot have changed and the league stays
    // backed off despite last_pulsed_at having moved.
    expect(syncLeagueMatchups).not.toHaveBeenCalled();
  });

  it("recomputes a 'settled' league once the (season, currentWeek, playoffWeekStart) triple changes", async () => {
    wireOkPipeline();
    // Stored triple says week 5; live NFL state has moved to week 6.
    vi.mocked(getNflState).mockResolvedValue({
      week: 6,
      season_type: "regular",
      season: "2026",
    } as never);
    const attemptedAt = new Date(Date.now() - 60_000).toISOString();
    const { client } = makeFakeClient({
      leaguesRow: {
        last_pulsed_at: null,
        power_pulse_status: "settled",
        power_pulse_detail:
          "no regular season games remaining from week 5 [settled season=2026 week=5 playoffStart=15]",
        power_pulse_attempted_at: attemptedAt,
      },
    });

    await refreshPowerPulse(client, LEAGUE_ROW_ID);

    expect(syncLeagueMatchups).toHaveBeenCalledTimes(1);
  });
});

/* ---------------------------------------------------------------------- */
/* force: true bypasses every backoff                                     */
/* ---------------------------------------------------------------------- */

describe("refreshPowerPulse force bypass", () => {
  it("recomputes a backed-off 'skipped' league when force is true", async () => {
    wireOkPipeline();
    const { client } = makeFakeClient({
      leaguesRow: {
        last_pulsed_at: null,
        power_pulse_status: "skipped",
        power_pulse_detail: "no rosters",
        power_pulse_attempted_at: new Date().toISOString(),
      },
    });

    await refreshPowerPulse(client, LEAGUE_ROW_ID, { force: true });

    expect(syncLeagueMatchups).toHaveBeenCalledTimes(1);
  });
});

/* ---------------------------------------------------------------------- */
/* E8-4: attempted_at before the expensive work, succeeded_at after the   */
/* cache rows land, by call order                                         */
/* ---------------------------------------------------------------------- */

describe("refreshPowerPulse write ordering (E8-4)", () => {
  it("stamps attempted_at, then upserts the cache rows, then stamps the verdict with succeeded_at", async () => {
    wireOkPipeline();
    const { client, calls, leagueUpdates } = makeFakeClient({
      leaguesRow: {
        last_pulsed_at: null,
        power_pulse_status: null,
        power_pulse_detail: null,
        power_pulse_attempted_at: null,
      },
      cacheRow: null,
    });

    await refreshPowerPulse(client, LEAGUE_ROW_ID, { force: true });

    const attemptedIdx = calls.indexOf("leagues.update:power_pulse_attempted_at");
    const upsertIdx = calls.indexOf("cache.upsert");
    const verdictIdx = calls.findIndex(
      (c) => c.startsWith("leagues.update:") && c.includes("power_pulse_succeeded_at"),
    );

    expect(attemptedIdx).toBeGreaterThanOrEqual(0);
    expect(upsertIdx).toBeGreaterThan(attemptedIdx);
    expect(verdictIdx).toBeGreaterThan(upsertIdx);

    const verdictUpdate = leagueUpdates.find((u) => "power_pulse_succeeded_at" in u);
    expect(verdictUpdate?.power_pulse_status).toBe("ok");
  });

  it("does not stamp succeeded_at when the run ends in 'error'", async () => {
    wireOkPipeline();
    // loadRosters throwing propagates out of calculateLeaguePowerPulse, which
    // refreshPowerPulse's outer catch turns into an 'error' verdict.
    vi.mocked(loadRosters).mockRejectedValue(new Error("db unreachable"));

    const { client, leagueUpdates } = makeFakeClient({
      leaguesRow: {
        last_pulsed_at: null,
        power_pulse_status: null,
        power_pulse_detail: null,
        power_pulse_attempted_at: null,
      },
      cacheRow: null,
    });

    await refreshPowerPulse(client, LEAGUE_ROW_ID, { force: true });

    const verdictUpdate = leagueUpdates.find((u) => "power_pulse_status" in u);
    expect(verdictUpdate?.power_pulse_status).toBe("error");
    expect(verdictUpdate?.power_pulse_succeeded_at).toBeUndefined();
  });
});

/* ---------------------------------------------------------------------- */
/* Settled detail carries the machine-readable triple                     */
/* ---------------------------------------------------------------------- */

describe("settled verdict detail encoding", () => {
  it("encodes (season, currentWeek, playoffWeekStart) into power_pulse_detail", async () => {
    wireOkPipeline();
    vi.mocked(syncLeagueMatchups).mockResolvedValue({
      ok: true,
      weeksFetched: [],
      rowsWritten: 0,
      failedWeeks: [],
      noScheduleYet: true, // -> "no published schedule" -> settled
    } as never);

    const { client, leagueUpdates } = makeFakeClient({
      leaguesRow: {
        last_pulsed_at: null,
        power_pulse_status: null,
        power_pulse_detail: null,
        power_pulse_attempted_at: null,
      },
      cacheRow: null,
    });

    await refreshPowerPulse(client, LEAGUE_ROW_ID, { force: true });

    const verdictUpdate = leagueUpdates.find((u) => u.power_pulse_status === "settled");
    expect(verdictUpdate?.power_pulse_detail).toBe(
      "no published schedule [settled season=2026 week=5 playoffStart=15]",
    );
  });
});

/* ---------------------------------------------------------------------- */
/* POWER_PULSE_RETRY_MS sanity                                            */
/* ---------------------------------------------------------------------- */

describe("POWER_PULSE_RETRY_MS", () => {
  it("is 15 minutes", () => {
    expect(POWER_PULSE_RETRY_MS).toBe(15 * 60 * 1000);
  });
});
