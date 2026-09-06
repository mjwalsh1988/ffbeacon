/**
 * Tests for the upgrade what-if (section 15.1.2 of
 * docs/league-pulse/league-pulse-positional-war-plan.md), acceptance criteria E1b-1
 * through E1b-5 plus the additional cases the plan calls out.
 *
 * WHAT IS REAL AND WHAT IS FAKED
 *
 * Every true I/O boundary is replaced with a plain fake: the Supabase reads
 * in lib/power-pulse/load.ts, the settings read, the Sleeper NFL-state fetch,
 * the Power Pulse cache read (lib/trade-impact/load.ts), and the Positional
 * WAR curve and viewer-candidate reads (lib/league-positional-war-data.ts).
 * None of those have interesting logic of their own to exercise here; they
 * already have their own tests.
 *
 * Everything downstream of that boundary is left REAL: lib/faab/marginal.ts
 * computeLineupSwap, lib/power-pulse/lineup.ts, lib/power-pulse/what-if.ts
 * simulateWithReplacements, and lib/power-pulse/simulate.ts simulateSeason all
 * run their actual implementations against the fake data. That is what makes
 * the determinism test and the baseline-separation test meaningful: they are
 * proving something about the real pipeline, not about a mock's behaviour.
 * lib/positional-war/load.test.ts already spies on a named export directly
 * (no vi.mock wrapper needed) for the same reason; this file follows that
 * pattern for computeLineupSwap and simulateWithReplacements so individual
 * tests can override just once while every other test gets the real
 * computation for free.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as marginalModule from "@/lib/faab/marginal";
import * as whatIfModule from "@/lib/power-pulse/what-if";
import * as simulateModule from "@/lib/power-pulse/simulate";
import { DEFAULT_POWER_PULSE_SETTINGS } from "@/lib/power-pulse/default-settings";
import type {
  AccuracyRow,
  DefenseRow,
  LeagueRow,
  PlayerRow,
  ProjectionRow,
  RosterRow,
} from "@/lib/power-pulse/load";
import type { ScheduleWeek } from "@/lib/power-pulse/types";
import type { WeeklyDistribution } from "@/lib/power-pulse/what-if";
import type { PositionCurve } from "@/lib/positional-war/types";
import type { ViewerCandidate } from "@/lib/league-viewer";
import type { WarView } from "@/lib/league-positional-war-data";

const LEAGUE_ROW_ID = "league-row-1";
const SLEEPER_LEAGUE_ID = "999999";
const SEASON = 2026;
const CURRENT_WEEK = 5;
const PLAYOFF_WEEK_START = 15;
const REGULAR_WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

// ---------------------------------------------------------------------------
// The Supabase fake used for the one direct read runUpgradeWhatIf and the
// action both make: resolving sleeper_league_id -> the league row id.
// ---------------------------------------------------------------------------

const supabaseState = vi.hoisted(() => ({
  leagueRow: { id: "league-row-1", season: 2026 } as {
    id: string;
    season: number;
  } | null,
}));

function makeFakeSupabase() {
  return {
    from(_table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: supabaseState.leagueRow,
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof import("./upgrade").runUpgradeWhatIf>[0];
}

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => makeFakeSupabase(),
  createClient: async () => makeFakeSupabase(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function league(overrides: Partial<LeagueRow> = {}): LeagueRow {
  return {
    id: LEAGUE_ROW_ID,
    sleeperLeagueId: SLEEPER_LEAGUE_ID,
    name: "Test League",
    season: SEASON,
    status: "in_season",
    rosterPositions: ["QB", "RB", "WR", "TE", "FLEX", "BN", "BN", "BN"],
    scoringSettings: {},
    playoffTeams: 4,
    playoffWeekStart: PLAYOFF_WEEK_START,
    playoffRoundType: 0,
    ...overrides,
  };
}

function roster(overrides: Partial<RosterRow>): RosterRow {
  return {
    id: `row-${overrides.sleeperRosterId}`,
    sleeperRosterId: 0,
    playerSleeperIds: [],
    starterSleeperIds: [],
    reserveSleeperIds: [],
    taxiSleeperIds: [],
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    teamName: `Team ${overrides.sleeperRosterId}`,
    ownerUserId: null,
    ownerHandle: null,
    ownerAvatarId: null,
    ...overrides,
  };
}

const VIEWER_ROSTER = roster({
  sleeperRosterId: 1,
  playerSleeperIds: ["s-qb1", "s-rb1", "s-wr1", "s-te1"],
  wins: 3,
  losses: 2,
  pointsFor: 500,
});

const RIVAL_ROSTERS = [
  roster({ sleeperRosterId: 2, wins: 2, losses: 3, pointsFor: 450 }),
  roster({ sleeperRosterId: 3, wins: 4, losses: 1, pointsFor: 520 }),
  roster({ sleeperRosterId: 4, wins: 1, losses: 4, pointsFor: 400 }),
];

const ALL_ROSTERS = [VIEWER_ROSTER, ...RIVAL_ROSTERS];

const PLAYER_DB: Record<string, PlayerRow> = {
  "s-qb1": {
    playerId: "p-qb1",
    sleeperId: "s-qb1",
    name: "Owned QB",
    position: "QB",
    team: "AAA",
    injuryStatus: null,
    depthOrder: 1,
  },
  "s-rb1": {
    playerId: "p-rb1",
    sleeperId: "s-rb1",
    name: "Owned RB",
    position: "RB",
    team: "AAA",
    injuryStatus: null,
    depthOrder: 1,
  },
  "s-wr1": {
    playerId: "p-wr1",
    sleeperId: "s-wr1",
    name: "Owned WR",
    position: "WR",
    team: "AAA",
    injuryStatus: null,
    depthOrder: 1,
  },
  "s-te1": {
    playerId: "p-te1",
    sleeperId: "s-te1",
    name: "Owned TE",
    position: "TE",
    team: "AAA",
    injuryStatus: null,
    depthOrder: 1,
  },
  "s-qb-target": {
    playerId: "p-qb-target",
    sleeperId: "s-qb-target",
    name: "Target QB",
    position: "QB",
    team: "BBB",
    injuryStatus: null,
    depthOrder: 1,
  },
  "s-qb-second": {
    playerId: "p-qb-second",
    sleeperId: "s-qb-second",
    name: "Second QB",
    position: "QB",
    team: "CCC",
    injuryStatus: null,
    depthOrder: 2,
  },
};

/** Points per remaining week, by FF Beacon player id. Deliberately static: no randomness anywhere in this file lives outside simulateSeason's seeded generator. */
const POINTS_BY_PLAYER: Record<string, number> = {
  "p-qb1": 16,
  "p-rb1": 14,
  "p-wr1": 12,
  "p-te1": 8,
  "p-qb-target": 24,
  "p-qb-second": 20,
};

const CURVE_QB_DEFAULT: PositionCurve = {
  position: "QB",
  structuralDemand: 1,
  replacementPoints: 10,
  avgSeatedPoints: 18,
  deficit: 8,
  shallowPool: false,
  warRank1: 1.23,
  warAtDemand: 1.23,
  cliffRank: null,
  curve: [
    {
      playerId: "p-qb-target",
      sleeperId: "s-qb-target",
      slug: "target-qb",
      name: "Target QB",
      team: "BBB",
      injuryStatus: null,
      positionRank: 1,
      war: 1.23,
      pointsAboveReplacement: 10,
      projectedPointsPerWeek: 20,
      replacementPointsPerWeek: 10,
      weeksProjected: 10,
    },
    {
      playerId: "p-qb-second",
      sleeperId: "s-qb-second",
      slug: "second-qb",
      name: "Second QB",
      team: "CCC",
      injuryStatus: null,
      positionRank: 2,
      war: 0.9,
      pointsAboveReplacement: 7,
      projectedPointsPerWeek: 16,
      replacementPointsPerWeek: 10,
      weeksProjected: 10,
    },
  ],
  weeklyDiagnostics: [],
};

/** The viewer already owns the true rank 1 (E1b's "you already hold RB1" case). */
const CURVE_QB_FALLBACK: PositionCurve = {
  ...CURVE_QB_DEFAULT,
  curve: [
    {
      ...CURVE_QB_DEFAULT.curve[0],
      playerId: "p-qb1",
      sleeperId: "s-qb1",
      name: "Owned QB",
      positionRank: 1,
      war: 1.5,
    },
    { ...CURVE_QB_DEFAULT.curve[0], positionRank: 2 },
  ],
};

/** Every ranked player at the position is already the viewer's. */
const CURVE_QB_ALL_OWNED: PositionCurve = {
  ...CURVE_QB_DEFAULT,
  curve: [
    {
      ...CURVE_QB_DEFAULT.curve[0],
      playerId: "p-qb1",
      sleeperId: "s-qb1",
      name: "Owned QB",
      positionRank: 1,
    },
  ],
};

const VIEWER_CANDIDATES: ViewerCandidate[] = [
  { sleeperRosterId: 1, ownerSleeperUsername: "vieweruser", ownerSleeperUserId: "u-1", coOwnerIds: [] },
  { sleeperRosterId: 2, ownerSleeperUsername: "rival2", ownerSleeperUserId: "u-2", coOwnerIds: [] },
  { sleeperRosterId: 3, ownerSleeperUsername: "rival3", ownerSleeperUserId: "u-3", coOwnerIds: [] },
  { sleeperRosterId: 4, ownerSleeperUsername: "rival4", ownerSleeperUserId: "u-4", coOwnerIds: [] },
];

function weeklyDistribution(
  weeks: number[],
  mean: number,
  sigma: number,
): WeeklyDistribution {
  return new Map(weeks.map((w) => [w, { mean, sigma }]));
}

function defaultCachedWeekly(): Map<number, WeeklyDistribution> {
  return new Map([
    [2, weeklyDistribution(REGULAR_WEEKS, 100, 15)],
    [3, weeklyDistribution(REGULAR_WEEKS, 95, 14)],
    [4, weeklyDistribution(REGULAR_WEEKS, 105, 16)],
  ]);
}

function scheduleWeeks(weeks: number[]): ScheduleWeek[] {
  return weeks.map((week) => ({
    week,
    opponents: new Map([
      [1, 2],
      [2, 1],
      [3, 4],
      [4, 3],
    ]),
    isFinal: false,
  }));
}

function warView(curve: PositionCurve): WarView {
  return {
    curves: [curve],
    generatedAt: new Date().toISOString(),
    modelVersion: "test",
    fromWeek: CURRENT_WEEK,
    throughWeek: 14,
    status: "ok",
    isStale: false,
    shallowPositions: [],
  };
}

// ---------------------------------------------------------------------------
// Mocks: the I/O boundary only.
// ---------------------------------------------------------------------------

const loadCachedWeeklyMock = vi.fn(async () => defaultCachedWeekly());
vi.mock("@/lib/trade-impact/load", () => ({
  loadCachedWeekly: (...args: unknown[]) =>
    loadCachedWeeklyMock(...(args as [])),
}));

const loadPositionalWarViewMock = vi.fn(async () => warView(CURVE_QB_DEFAULT));
const loadViewerCandidatesMock = vi.fn(async () => VIEWER_CANDIDATES);
vi.mock("@/lib/league-positional-war-data", () => ({
  loadPositionalWarView: (...args: unknown[]) =>
    loadPositionalWarViewMock(...(args as [])),
  loadViewerCandidates: (...args: unknown[]) =>
    loadViewerCandidatesMock(...(args as [])),
}));

const claimWarUpgradeSlotMock = vi.fn(async () => true);
// The cheap outer meter, claimed before any read. Defaults to allowing, so the
// tests below exercise the gate they are actually about; the one test that
// cares asserts it fires first.
const claimWarUpgradeEntrySlotMock = vi.fn(async () => true);
vi.mock("@/lib/positional-war/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rate-limit")>();
  return {
    ...actual,
    claimWarUpgradeSlot: (...args: unknown[]) =>
      claimWarUpgradeSlotMock(...(args as [])),
    claimWarUpgradeEntrySlot: (...args: unknown[]) =>
      claimWarUpgradeEntrySlotMock(...(args as [])),
  };
});

const getNflStateMock = vi.fn(async () => ({
  week: CURRENT_WEEK,
  season_type: "regular",
  season: String(SEASON),
}));
vi.mock("@/lib/sleeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sleeper")>();
  return {
    ...actual,
    getNflState: (...args: unknown[]) => getNflStateMock(...(args as [])),
  };
});

let currentLeague = league();
let currentRosters = ALL_ROSTERS;

vi.mock("@/lib/power-pulse/load", () => ({
  loadLeague: async () => currentLeague,
  loadRosters: async () => currentRosters,
  loadPlayers: async (_supabase: unknown, sleeperIds: string[]) => {
    const out = new Map<string, PlayerRow>();
    for (const id of sleeperIds) {
      const row = PLAYER_DB[id];
      if (row) out.set(id, row);
    }
    return out;
  },
  loadProjections: async (): Promise<ProjectionRow[]> => [],
  loadAccuracy: async (): Promise<Map<string, AccuracyRow>> => new Map(),
  loadDefenseSplits: async (): Promise<Map<string, DefenseRow>> => new Map(),
  loadSchedule: async () => ({
    weeks: scheduleWeeks(REGULAR_WEEKS),
    setLineups: new Map(),
  }),
}));

vi.mock("@/lib/power-pulse/settings", () => ({
  loadPowerPulseSettings: async () => ({
    ...DEFAULT_POWER_PULSE_SETTINGS,
    simulation: { runs: 300, seed: 424242 },
  }),
}));

vi.mock("@/lib/power-pulse/project", () => ({
  reliabilityMultiplier: () => 1,
  projectPlayerWeek: ({
    subject,
    week,
  }: {
    subject: { playerId: string };
    week: number;
  }) => {
    const points = POINTS_BY_PLAYER[subject.playerId] ?? 5;
    return {
      week,
      points,
      rawPoints: points,
      sigma: points * 0.25,
      opponentMultiplier: 1,
      opponent: "OPP",
      usedLeagueScoring: true,
    };
  },
}));

async function loadModule() {
  return import("./upgrade");
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseState.leagueRow = { id: LEAGUE_ROW_ID, season: SEASON };
  currentLeague = league();
  currentRosters = ALL_ROSTERS;
  loadCachedWeeklyMock.mockImplementation(async () => defaultCachedWeekly());
  loadPositionalWarViewMock.mockImplementation(async () =>
    warView(CURVE_QB_DEFAULT),
  );
  loadViewerCandidatesMock.mockImplementation(async () => VIEWER_CANDIDATES);
  claimWarUpgradeSlotMock.mockImplementation(async () => true);
  claimWarUpgradeEntrySlotMock.mockImplementation(async () => true);
  getNflStateMock.mockImplementation(async () => ({
    week: CURRENT_WEEK,
    season_type: "regular",
    season: String(SEASON),
  }));
  vi.spyOn(marginalModule, "computeLineupSwap");
  vi.spyOn(whatIfModule, "simulateWithReplacements");
  vi.spyOn(simulateModule, "simulateSeason");
});

const fakeSupabase = makeFakeSupabase();

// ---------------------------------------------------------------------------
// E1b-1: no simulation runs on any GET.
// ---------------------------------------------------------------------------

describe("E1b-1: the simulation never runs during a page render", () => {
  it("is unreachable from the three GET pages: none of them names the simulating functions", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const root = path.resolve(__dirname, "..", "..");

    const filesToCheck = [
      "app/leagues/[league_id]/page.tsx",
      "app/leagues/[league_id]/power-pulse/page.tsx",
      "app/leagues/[league_id]/positional-war/page.tsx",
      "components/league-war/positional-war-panel.tsx",
      "components/league-war/war-rail-summary.tsx",
    ];

    for (const rel of filesToCheck) {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) continue;
      const source = fs.readFileSync(abs, "utf8");
      // positional-war/page.tsx legitimately imports resolveUpgradePanelAvailability
      // (a read-only lookup, no simulation) from lib/positional-war/upgrade.ts,
      // and the client upgrade-panel component (which itself imports the
      // server action, but only calls it from a button's onClick, never
      // during render). What none of these GET-rendered files may do is name
      // the two functions that actually run the simulation.
      expect(source).not.toMatch(/\brunUpgradeWhatIf\b/);
      expect(source).not.toMatch(/\brequestUpgradeWhatIf\b/);
    }
  });

  it("resolveUpgradePanelAvailability, the function the page's GET render actually calls, never touches simulateSeason", async () => {
    const { resolveUpgradePanelAvailability } = await loadModule();
    const result = await resolveUpgradePanelAvailability(fakeSupabase, {
      leagueRowId: LEAGUE_ROW_ID,
      season: SEASON,
      viewerRosterId: 1,
    });
    expect(result).toEqual({ ok: true });
    expect(simulateModule.simulateSeason).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// E1b-2: viewer roster re-derivation.
// ---------------------------------------------------------------------------

describe("E1b-2: the viewer's roster is re-derived, never trusted from the payload", () => {
  it("accepts a submitted roster id that matches the derivation", async () => {
    const { resolveUpgradeViewerRoster } = await loadModule();
    const result = await resolveUpgradeViewerRoster(fakeSupabase, {
      leagueRowId: LEAGUE_ROW_ID,
      submittedRosterId: 1,
      searchedUsername: "vieweruser",
      viewerSleeperUserId: null,
      focusedRosterId: null,
    });
    expect(result).toEqual({ ok: true, rosterId: 1 });
  });

  it("refuses a forged roster id the viewer resolution did not produce", async () => {
    const { resolveUpgradeViewerRoster } = await loadModule();
    const result = await resolveUpgradeViewerRoster(fakeSupabase, {
      leagueRowId: LEAGUE_ROW_ID,
      submittedRosterId: 2,
      searchedUsername: "vieweruser",
      viewerSleeperUserId: null,
      focusedRosterId: null,
    });
    expect(result).toEqual({ ok: false, reason: "roster-mismatch" });
  });

  it("refuses when no viewer roster resolves at all", async () => {
    const { resolveUpgradeViewerRoster } = await loadModule();
    const result = await resolveUpgradeViewerRoster(fakeSupabase, {
      leagueRowId: LEAGUE_ROW_ID,
      submittedRosterId: 1,
      searchedUsername: "nobody-in-this-league",
      viewerSleeperUserId: null,
      focusedRosterId: null,
    });
    expect(result).toEqual({ ok: false, reason: "no-viewer" });
  });

  it("the action refuses a forged roster id end to end and spends no rate-limit slot", async () => {
    const { requestUpgradeWhatIf } =
      await import("../../app/leagues/[league_id]/positional-war/actions");
    const outcome = await requestUpgradeWhatIf({
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      submittedRosterId: 2, // forged: the viewer is roster 1
      searchedUsername: "vieweruser",
      viewerSleeperUserId: null,
      focusedRosterId: null,
    });
    expect(outcome).toEqual({ ok: false, reason: "roster-mismatch" });
    expect(claimWarUpgradeSlotMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// E1b-3: validation precedes the claim.
// ---------------------------------------------------------------------------

describe("E1b-3: a malformed payload consumes no rate-limit slot", () => {
  it("rejects a malformed payload before any claim", async () => {
    const { requestUpgradeWhatIf } =
      await import("../../app/leagues/[league_id]/positional-war/actions");
    const outcome = await requestUpgradeWhatIf({
      sleeperLeagueId: "not-a-sleeper-id",
      position: "NOT_A_POSITION",
      submittedRosterId: -1,
      searchedUsername: null,
      focusedRosterId: null,
    });
    expect(outcome).toEqual({ ok: false, reason: "invalid" });
    expect(claimWarUpgradeSlotMock).not.toHaveBeenCalled();
    // A malformed payload is rejected by the shape check, which runs before
    // even the cheap outer meter, so it costs nothing at all.
    expect(claimWarUpgradeEntrySlotMock).not.toHaveBeenCalled();
  });

  it("refuses a shaped payload at the outer meter before touching the database", async () => {
    // The evaluation meter is claimed after validation, which is right for a
    // reader on a stale page. But a shaped-but-invalid payload would otherwise
    // buy the league lookup and the two reads inside the roster derivation for
    // free. The outer meter is what stops a caller sending shaped garbage in a
    // loop from spending our database for nothing.
    claimWarUpgradeEntrySlotMock.mockImplementation(async () => false);
    const { requestUpgradeWhatIf } =
      await import("../../app/leagues/[league_id]/positional-war/actions");
    const outcome = await requestUpgradeWhatIf({
      sleeperLeagueId: "1234567890",
      position: "QB",
      submittedRosterId: 3,
      searchedUsername: null,
      focusedRosterId: null,
    });
    expect(outcome).toEqual({ ok: false, reason: "rate-limited" });
    // Refused before the expensive meter and before any read.
    expect(claimWarUpgradeSlotMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// E1b-5: five per minute, honoured by the action.
// ---------------------------------------------------------------------------

describe("E1b-5: six presses in one minute produce five answers and one refusal", () => {
  it("the sixth request is rate-limited", async () => {
    const { WAR_UPGRADE_MAX } = await import("./rate-limit");
    let claimed = 0;
    claimWarUpgradeSlotMock.mockImplementation(async () => {
      claimed += 1;
      return claimed <= WAR_UPGRADE_MAX;
    });

    const { requestUpgradeWhatIf } =
      await import("../../app/leagues/[league_id]/positional-war/actions");
    const outcomes = [];
    for (let i = 0; i < 6; i += 1) {
      outcomes.push(
        await requestUpgradeWhatIf({
          sleeperLeagueId: SLEEPER_LEAGUE_ID,
          position: "QB",
          submittedRosterId: 1,
          searchedUsername: "vieweruser",
          focusedRosterId: null,
        }),
      );
    }

    const rateLimited = outcomes.filter(
      (o) => !o.ok && o.reason === "rate-limited",
    );
    const notRateLimited = outcomes.filter(
      (o) => o.ok || o.reason !== "rate-limited",
    );
    expect(rateLimited).toHaveLength(1);
    expect(notRateLimited).toHaveLength(5);
    expect(outcomes[5]).toEqual({ ok: false, reason: "rate-limited" });
  });
});

// ---------------------------------------------------------------------------
// The computation itself.
// ---------------------------------------------------------------------------

describe("runUpgradeWhatIf", () => {
  it("targets the highest-WAR player at the position who is not on the viewer's roster", async () => {
    const { runUpgradeWhatIf } = await loadModule();
    const outcome = await runUpgradeWhatIf(fakeSupabase, {
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      rosterId: 1,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.target.playerId).toBe("p-qb-target");
    expect(outcome.result.target.positionRank).toBe(1);
    expect(outcome.result.target.positionalWar).toBe(1.23);
    expect(outcome.result.fellBackFrom).toBeNull();
  });

  it("skips a player already on the viewer's roster and says so (fell back one rank)", async () => {
    loadPositionalWarViewMock.mockImplementation(async () =>
      warView(CURVE_QB_FALLBACK),
    );
    const { runUpgradeWhatIf } = await loadModule();
    const outcome = await runUpgradeWhatIf(fakeSupabase, {
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      rosterId: 1,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.target.playerId).toBe("p-qb-target");
    expect(outcome.result.target.positionRank).toBe(2);
    expect(outcome.result.fellBackFrom).toEqual({ positionRank: 1 });
  });

  it("reports unavailable when every ranked player at the position is already the viewer's", async () => {
    loadPositionalWarViewMock.mockImplementation(async () =>
      warView(CURVE_QB_ALL_OWNED),
    );
    const { runUpgradeWhatIf } = await loadModule();
    const outcome = await runUpgradeWhatIf(fakeSupabase, {
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      rosterId: 1,
    });
    expect(outcome).toEqual({ ok: false, reason: "no-candidates" });
  });

  it("reports unavailable, not zero, when Power Pulse has no cached rows", async () => {
    loadCachedWeeklyMock.mockImplementation(async () => new Map());
    const { runUpgradeWhatIf } = await loadModule();
    const outcome = await runUpgradeWhatIf(fakeSupabase, {
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      rosterId: 1,
    });
    expect(outcome).toEqual({ ok: false, reason: "no-baseline" });
  });

  it("reports unavailable, not zero, when the cache is missing one roster", async () => {
    loadCachedWeeklyMock.mockImplementation(async () => {
      const partial = defaultCachedWeekly();
      partial.delete(4);
      return partial;
    });
    const { runUpgradeWhatIf } = await loadModule();
    const outcome = await runUpgradeWhatIf(fakeSupabase, {
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      rosterId: 1,
    });
    expect(outcome).toEqual({ ok: false, reason: "no-baseline" });
  });

  it("surfaces a null simulateWithReplacements as unavailable, never as zero", async () => {
    vi.spyOn(whatIfModule, "simulateWithReplacements").mockReturnValueOnce(
      null,
    );
    const { runUpgradeWhatIf } = await loadModule();
    const outcome = await runUpgradeWhatIf(fakeSupabase, {
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      rosterId: 1,
    });
    expect(outcome).toEqual({ ok: false, reason: "no-season-left" });
  });

  it("reports unavailable when the schedule has no unplayed regular-season weeks", async () => {
    currentLeague = league({ playoffWeekStart: CURRENT_WEEK });
    const { runUpgradeWhatIf } = await loadModule();
    const outcome = await runUpgradeWhatIf(fakeSupabase, {
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      rosterId: 1,
    });
    expect(outcome).toEqual({ ok: false, reason: "no-season-left" });
  });

  it("configures no drop guard, which is why the result carries no drop note", async () => {
    // The panel used to render computeLineupSwap's dropNote, and that
    // paragraph could never appear: both branches of chooseDrop that produce
    // a note require a drop guard, and this caller configures none. Rather
    // than assert a pass-through against a mocked return that the real call
    // cannot produce, this pins the actual input: no `dropGuard`, and no
    // `rosterValues` or `candidateValue` for one to rank against.
    //
    // If a guard is ever configured here, this fails, and the sentence the
    // guard produces has to be surfaced again in
    // components/league-war/upgrade-panel.tsx along with it. Both modes of the
    // guard rank the roster by trade value, so adding one also means deciding
    // what a value-source dependency is doing inside a source-independent
    // feature.
    const spy = vi.spyOn(marginalModule, "computeLineupSwap");
    const { runUpgradeWhatIf } = await loadModule();
    const outcome = await runUpgradeWhatIf(fakeSupabase, {
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      rosterId: 1,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0][0];
    expect(input.dropGuard).toBeUndefined();
    expect(input.rosterValues).toBeUndefined();
    expect(input.candidateValue).toBeUndefined();

    // And the real call, unmocked, produced no note to lose.
    expect(spy.mock.results[0].type).toBe("return");
    const swap = spy.mock.results[0].value as { dropNote: string | null };
    expect(swap.dropNote).toBeNull();

    expect(outcome.result).not.toHaveProperty("dropNote");
    expect(outcome.result.winsDelta).not.toBeNull();
  });

  it("the baseline rule: only the viewer's distribution changes between before and after", async () => {
    const { runUpgradeWhatIf } = await loadModule();
    const outcome = await runUpgradeWhatIf(fakeSupabase, {
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      rosterId: 1,
    });
    expect(outcome.ok).toBe(true);

    expect(whatIfModule.simulateWithReplacements).toHaveBeenCalledTimes(1);
    const call = vi.mocked(whatIfModule.simulateWithReplacements).mock
      .calls[0][0];

    // Exactly one roster changes: the viewer's.
    expect(call.replacements.size).toBe(1);
    expect([...call.replacements.keys()]).toEqual([1]);

    // Every other roster's baseline entry is exactly what the Power Pulse
    // cache produced, untouched. Nothing here was recomputed.
    const cached = defaultCachedWeekly();
    for (const rivalId of [2, 3, 4]) {
      expect(call.baseline.get(rivalId)).toEqual(cached.get(rivalId));
    }
    // The viewer's own baseline entry comes from computeLineupSwap's
    // weeklyBefore, not from the cache (the cache has no row for roster 1
    // in this fixture).
    expect(call.baseline.has(1)).toBe(true);
  });

  it("two runs with the same seed and inputs produce identical deltas", async () => {
    const { runUpgradeWhatIf } = await loadModule();
    const first = await runUpgradeWhatIf(fakeSupabase, {
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      rosterId: 1,
    });
    const second = await runUpgradeWhatIf(fakeSupabase, {
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      rosterId: 1,
    });
    expect(first).toEqual(second);
  });

  it("league-not-found when the sleeper league id does not resolve", async () => {
    supabaseState.leagueRow = null;
    const { runUpgradeWhatIf } = await loadModule();
    const outcome = await runUpgradeWhatIf(fakeSupabase, {
      sleeperLeagueId: SLEEPER_LEAGUE_ID,
      position: "QB",
      rosterId: 1,
    });
    expect(outcome).toEqual({ ok: false, reason: "league-not-found" });
  });
});
