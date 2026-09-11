/**
 * Coverage for the two-to-eight-candidate generalization of
 * calculateLeagueImpact (SEO-T927).
 *
 * The dependencies calculateLeagueImpact calls are mocked so a test can drive
 * the orchestration (the candidate-count guard, the notices, the per-candidate
 * fan-out) without assembling a full league, matching the pattern
 * lib/league-power-pulse.test.ts uses for the sibling orchestrator. Two
 * "engine"-shaped functions are mocked outright (computeLineupSwap,
 * simulateSeason), and buildOptimalLineup / lineupSigma are stubbed to a fixed
 * zero so the ONE shared "as it stands" simulation (built from every roster's
 * real players, most of which have no projection fixture here) is
 * deterministic; startingSlots and every other pure helper (closestScoringBase,
 * describeLeagueScoring, resolveCurrentWeek, defenseSeasonsFor,
 * projectPlayerWeek) run for real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

vi.mock("@/lib/power-pulse/load", () => ({
  loadLeague: vi.fn(),
  loadRosters: vi.fn(),
  loadPlayers: vi.fn(),
  loadProjections: vi.fn(),
  loadAccuracy: vi.fn(),
  loadDefenseSplits: vi.fn(),
  loadSchedule: vi.fn(),
}));

vi.mock("@/lib/power-pulse/settings", () => ({
  loadPowerPulseSettings: vi.fn(),
}));

vi.mock("@/lib/sleeper", () => ({
  getNflState: vi.fn(),
}));

vi.mock("@/lib/faab/marginal", () => ({
  computeLineupSwap: vi.fn(),
}));

vi.mock("@/lib/power-pulse/simulate", () => ({
  simulateSeason: vi.fn(),
}));

vi.mock("@/lib/power-pulse/lineup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/power-pulse/lineup")>();
  return {
    ...actual,
    // The "as it stands" total for every roster in the league, computed once
    // and shared across every candidate. Fixed to zero so the test does not
    // have to reproduce the real fill algorithm's arithmetic for the handful
    // of rostered players that happen to also be candidates below;
    // lib/power-pulse/lineup.test.ts already covers that algorithm.
    buildOptimalLineup: vi.fn(() => ({ slots: [], total: 0, benched: [] })),
    lineupSigma: vi.fn(() => 0),
  };
});

import { calculateLeagueImpact } from "./league-impact";
import {
  loadLeague,
  loadRosters,
  loadPlayers,
  loadProjections,
  loadAccuracy,
  loadDefenseSplits,
  loadSchedule,
  type LeagueRow,
  type RosterRow,
  type PlayerRow,
  type ProjectionRow,
} from "@/lib/power-pulse/load";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { getNflState } from "@/lib/sleeper";
import { computeLineupSwap } from "@/lib/faab/marginal";
import { simulateSeason } from "@/lib/power-pulse/simulate";
import { DEFAULT_POWER_PULSE_SETTINGS } from "@/lib/power-pulse/default-settings";

const fakeSupabase = {} as SupabaseClient<Database>;

const LEAGUE: LeagueRow = {
  id: "league-row-1",
  sleeperLeagueId: "sleeper-1",
  name: "Test League",
  season: 2026,
  status: "in_season",
  // Four startable slots (QB, RB, WR, FLEX) plus two bench: six total, well
  // above the one player the "mine" roster carries below, so the roster-full
  // drop path never engages in these tests.
  rosterPositions: ["QB", "RB", "WR", "FLEX", "BN", "BN"],
  scoringSettings: { rec: 1 },
  playoffTeams: 4,
  playoffWeekStart: 7,
  playoffRoundType: 0,
};

const MINE: RosterRow = {
  id: "roster-row-1",
  sleeperRosterId: 1,
  playerSleeperIds: ["c1"],
  starterSleeperIds: [],
  reserveSleeperIds: [],
  taxiSleeperIds: [],
  wins: 5,
  losses: 3,
  ties: 0,
  pointsFor: 900,
  teamName: "My Team",
  ownerUserId: null,
  ownerHandle: null,
  ownerAvatarId: null,
};

const OTHER: RosterRow = {
  id: "roster-row-2",
  sleeperRosterId: 2,
  playerSleeperIds: ["c3"],
  starterSleeperIds: [],
  reserveSleeperIds: [],
  taxiSleeperIds: [],
  wins: 3,
  losses: 5,
  ties: 0,
  pointsFor: 800,
  teamName: "Other Team",
  ownerUserId: null,
  ownerHandle: null,
  ownerAvatarId: null,
};

function candidatePlayer(sleeperId: string): PlayerRow {
  return {
    playerId: `${sleeperId}-uuid`,
    sleeperId,
    name: `Candidate ${sleeperId}`,
    position: "WR",
    team: "DET",
    injuryStatus: null,
    depthOrder: null,
  };
}

const PLAYERS = new Map<string, PlayerRow>([
  ["c1", candidatePlayer("c1")], // on MINE's roster: the "already mine" case
  ["c2", candidatePlayer("c2")], // free agent: on nobody's roster
  ["c3", candidatePlayer("c3")], // on OTHER's roster: the "rostered elsewhere" case
  // "missing" is deliberately absent from this map, so calculateLeagueImpact
  // treats it as unmatched, the same as a candidate whose slug has no Sleeper
  // id at all.
]);

function projectionRowsFor(playerId: string): ProjectionRow[] {
  return [5, 6].map((week) => ({
    playerId,
    week,
    opponent: "SEA",
    statLine: null,
    ppr: 10,
    halfPpr: 9,
    std: 8,
    availability: "projected",
  }));
}

const PROJECTIONS: ProjectionRow[] = [
  ...projectionRowsFor("c1-uuid"),
  ...projectionRowsFor("c2-uuid"),
  ...projectionRowsFor("c3-uuid"),
];

/** Net points per week computeLineupSwap hands back for each candidate. */
const SWAP_BASE: Record<string, number> = {
  "c1-uuid": 4,
  "c2-uuid": 2,
  "c3-uuid": 1,
};

beforeEach(() => {
  // Every vi.mock() factory above returns the SAME mock functions for the
  // whole file, so call counts accumulate across tests unless cleared here.
  // The assertions below check how many times a shared read fires for ONE
  // calculateLeagueImpact call, which only means something against a clean
  // slate.
  vi.clearAllMocks();

  vi.mocked(loadLeague).mockResolvedValue(LEAGUE);
  vi.mocked(loadRosters).mockResolvedValue([MINE, OTHER]);
  vi.mocked(loadPlayers).mockResolvedValue(PLAYERS);
  vi.mocked(loadProjections).mockResolvedValue(PROJECTIONS);
  vi.mocked(loadAccuracy).mockResolvedValue(new Map());
  vi.mocked(loadDefenseSplits).mockResolvedValue(new Map());
  vi.mocked(loadSchedule).mockResolvedValue({
    weeks: [{ week: 5, opponents: new Map([[1, 2], [2, 1]]), isFinal: false }],
    setLineups: new Map(),
  });
  vi.mocked(loadPowerPulseSettings).mockResolvedValue(DEFAULT_POWER_PULSE_SETTINGS);
  vi.mocked(getNflState).mockResolvedValue({
    week: 5,
    season_type: "regular",
    season: "2026",
  } as never);

  vi.mocked(computeLineupSwap).mockImplementation((input) => {
    const base = SWAP_BASE[input.candidatePlayerId] ?? 0;
    const weeklyBefore = new Map(input.weeks.map((w) => [w, { mean: 100, sigma: 10 }]));
    const weeklyAfter = new Map(input.weeks.map((w) => [w, { mean: 100 + base, sigma: 10 }]));
    return {
      weeks: input.weeks.map((w) => ({
        week: w,
        startsForYou: base > 0,
        pointsAdded: base,
        opponent: "SEA",
        opponentMultiplier: 1,
      })),
      weeksConsidered: input.weeks.length,
      weeksStarting: base > 0 ? input.weeks.length : 0,
      pointsPerWeek: base,
      pointsPerStartedWeek: base,
      netPointsPerWeek: base,
      dropCost: null,
      dropOptions: [],
      dropNote: null,
      isBenchOnly: base === 0,
      weeklyBefore,
      weeklyAfter,
    };
  });

  // Odds move with the roster's own projected mean, so the "alreadyMine"
  // stripped baseline, the free-agent baseline, and the after-swap figure are
  // all distinguishable in the assertions below.
  vi.mocked(simulateSeason).mockImplementation((teams) => {
    const out = new Map();
    for (const t of teams) {
      out.set(t.sleeperRosterId, {
        expectedWins: t.mean / 20,
        playoffOdds: Math.min(1, Math.max(0, t.mean / 200)),
        byeOdds: 0,
        titleOdds: Math.min(1, Math.max(0, t.mean / 400)),
        lastPlaceOdds: 0,
      });
    }
    return out;
  });
});

describe("calculateLeagueImpact: candidate count guard", () => {
  it("refuses fewer than two candidates without touching the league", async () => {
    const outcome = await calculateLeagueImpact(fakeSupabase, {
      leagueRowId: "league-row-1",
      sleeperRosterId: 1,
      candidateSleeperIds: ["c1"],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/2 to 8/);
    expect(loadLeague).not.toHaveBeenCalled();
  });

  it("refuses more than eight candidates without touching the league", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `c${i}`);
    const outcome = await calculateLeagueImpact(fakeSupabase, {
      leagueRowId: "league-row-1",
      sleeperRosterId: 1,
      candidateSleeperIds: nine,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/2 to 8/);
    expect(loadLeague).not.toHaveBeenCalled();
  });
});

describe("calculateLeagueImpact: two candidates (pairwise parity)", () => {
  it("keeps the original one-of-two notice wording when one candidate cannot be measured", async () => {
    const outcome = await calculateLeagueImpact(fakeSupabase, {
      leagueRowId: "league-row-1",
      sleeperRosterId: 1,
      candidateSleeperIds: ["c1", "missing"],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.impacts).toHaveLength(2);
    expect(outcome.report.impacts[0]).not.toBeNull();
    expect(outcome.report.impacts[1]).toBeNull();
    expect(outcome.report.notices).toContain(
      "We could only measure one of these two against your roster. The other has no weekly projections on file from here on.",
    );
    // The unmatched candidate never reaches the swap calculation.
    expect(computeLineupSwap).toHaveBeenCalledTimes(1);
  });
});

describe("calculateLeagueImpact: three to eight candidates", () => {
  it("returns one impact per candidate, in board order, sharing every league-level read once", async () => {
    const outcome = await calculateLeagueImpact(fakeSupabase, {
      leagueRowId: "league-row-1",
      sleeperRosterId: 1,
      candidateSleeperIds: ["c1", "c2", "c3"],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { impacts } = outcome.report;
    expect(impacts).toHaveLength(3);
    expect(impacts.every((i) => i !== null)).toBe(true);

    // Reads that do not depend on which candidate is being measured happen
    // exactly once, however many candidates are on the board.
    expect(loadLeague).toHaveBeenCalledTimes(1);
    expect(loadRosters).toHaveBeenCalledTimes(1);
    expect(loadPlayers).toHaveBeenCalledTimes(1);
    expect(loadProjections).toHaveBeenCalledTimes(1);
    expect(loadAccuracy).toHaveBeenCalledTimes(1);
    expect(loadDefenseSplits).toHaveBeenCalledTimes(1);
    expect(loadSchedule).toHaveBeenCalledTimes(1);

    // Only the per-candidate swap and simulation run once per candidate, in
    // the order the candidates were given, regardless of the Promise.all fan
    // out below calculateLeagueImpact.
    expect(computeLineupSwap).toHaveBeenCalledTimes(3);
    expect(vi.mocked(computeLineupSwap).mock.calls.map((c) => c[0].candidatePlayerId)).toEqual([
      "c1-uuid",
      "c2-uuid",
      "c3-uuid",
    ]);

    // c1: already on the reader's roster.
    expect(impacts[0]).toMatchObject({
      onYourRoster: true,
      rosteredBy: null,
      netPointsPerWeek: 4,
      weeksStarting: 2,
      weeksConsidered: 2,
    });
    // c2: a free agent, rostered by nobody.
    expect(impacts[1]).toMatchObject({
      onYourRoster: false,
      rosteredBy: null,
      netPointsPerWeek: 2,
    });
    // c3: rostered by the other team.
    expect(impacts[2]).toMatchObject({
      onYourRoster: false,
      rosteredBy: "Other Team",
      netPointsPerWeek: 1,
    });

    // The odds delta scales with each candidate's own swap, computed
    // independently: c1's "before" baseline is stripped of himself (his own
    // roster already carries his points), while c2 and c3 are measured from
    // the same as-it-stands baseline, so their deltas differ even though the
    // "after" figures are close together.
    expect(impacts[0]!.expectedWinsAdded).toBeCloseTo(0.2, 5); // (100+4)/20 - 100/20
    expect(impacts[1]!.expectedWinsAdded).toBeCloseTo(5.1, 5); // (0+102)/20 - 0/20... see below
    expect(impacts[2]!.expectedWinsAdded).toBeCloseTo(5.05, 5);

    expect(outcome.report.notices.some((n) => n.includes("could only measure"))).toBe(false);
  });

  it("reports a generalized notice, not the two-candidate wording, when some of several candidates cannot be measured", async () => {
    const outcome = await calculateLeagueImpact(fakeSupabase, {
      leagueRowId: "league-row-1",
      sleeperRosterId: 1,
      candidateSleeperIds: ["c1", "c2", "missing", "also-missing"],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.impacts).toHaveLength(4);
    expect(outcome.report.impacts[0]).not.toBeNull();
    expect(outcome.report.impacts[1]).not.toBeNull();
    expect(outcome.report.impacts[2]).toBeNull();
    expect(outcome.report.impacts[3]).toBeNull();
    expect(outcome.report.notices).toContain(
      "We could only measure 2 of these 4 against your roster. The rest have no weekly projections on file from here on.",
    );
  });

  it("keeps every candidate's board position even when only the last one is measurable", async () => {
    const outcome = await calculateLeagueImpact(fakeSupabase, {
      leagueRowId: "league-row-1",
      sleeperRosterId: 1,
      candidateSleeperIds: ["missing", "also-missing", "c3"],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.impacts).toEqual([null, null, expect.objectContaining({ rosteredBy: "Other Team" })]);
    // Two of the three are missing, not one, so this is the plural form.
    expect(outcome.report.notices).toContain(
      "We could only measure 1 of these 3 against your roster. The rest have no weekly projections on file from here on.",
    );
  });
});
