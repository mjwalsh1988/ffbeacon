/**
 * Coverage for lib/league-pulse.ts pulseLeagueFootprint: the lighter capture
 * a Manager Pulse run queues instead of a full pulse.
 *
 * The whole point of this function is what it does NOT run: trade-value
 * power rankings, Power Pulse, Positional WAR and the Manager Ledger are all
 * mocked here so a call into any of them fails the test, the same way
 * lib/league-positional-war.test.ts mocks its neighbours to isolate one
 * orchestrator's own branches.
 *
 * Mirrors the fake-Supabase-client pattern in lib/league-positional-war.test.ts:
 * a `from(table)` dispatcher returning small chainable builders, recording
 * every operation in order in `calls` so write-ordering assertions do not
 * depend on inspecting timestamps.
 *
 * Since MPS-T015/T016, everything beyond the core rows runs through the
 * capture set (captureLeagueRawData): transactions, brackets, draft
 * selections and (for the footprint path only) the matchup slate. Draft
 * selections and the matchup slate are mocked out wholesale here (their own
 * modules have their own tests); this file only needs to prove the capture
 * set is called, that an incomplete set fails the footprint job, and that a
 * cached core skips the set entirely.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sleeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sleeper")>();
  return {
    ...actual,
    getSleeperLeague: vi.fn(),
    getSleeperRosters: vi.fn(),
    getSleeperLeagueUsers: vi.fn(),
    getSleeperTradedPicks: vi.fn(),
    getSleeperLeagueDrafts: vi.fn(),
    getSleeperDraft: vi.fn(),
    getAllSleeperTransactions: vi.fn(),
    getSleeperWinnersBracket: vi.fn(),
    getSleeperLosersBracket: vi.fn(),
    getNflState: vi.fn(),
  };
});

vi.mock("@/lib/sleeper-to-format", () => ({
  deriveFormatSlug: vi.fn(() => null),
}));

// The whole point of pulseLeagueFootprint is that it never reaches these.
vi.mock("@/lib/league-power-rankings", () => ({
  calculateLeaguePowerRankings: vi.fn(),
}));
vi.mock("@/lib/league-power-pulse", () => ({
  refreshPowerPulse: vi.fn(),
}));
vi.mock("@/lib/league-positional-war", () => ({
  refreshPositionalWar: vi.fn(),
}));
vi.mock("@/lib/league-manager-ledger", () => ({
  refreshManagerLedger: vi.fn(),
}));

// Draft selections have their own test file; here it is just a stage inside
// the capture set that must be called and whose result feeds `complete`.
vi.mock("@/lib/league-draft-selections", () => ({
  captureLeagueDraftSelections: vi.fn(),
}));

// The matchup slate is only fetched on the footprint path
// (includeMatchups: true). resolveCurrentWeek stays real (it is pure); only
// the Sleeper-touching sync is mocked.
vi.mock("@/lib/league-matchups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/league-matchups")>();
  return {
    ...actual,
    syncLeagueMatchups: vi.fn(),
  };
});

import { pulseLeagueFootprint, captureLeagueRawData } from "./league-pulse";
import {
  getSleeperLeague,
  getSleeperRosters,
  getSleeperLeagueUsers,
  getSleeperTradedPicks,
  getSleeperLeagueDrafts,
  getAllSleeperTransactions,
  getSleeperWinnersBracket,
  getSleeperLosersBracket,
  getNflState,
} from "@/lib/sleeper";
import { calculateLeaguePowerRankings } from "@/lib/league-power-rankings";
import { refreshPowerPulse } from "@/lib/league-power-pulse";
import { refreshPositionalWar } from "@/lib/league-positional-war";
import { refreshManagerLedger } from "@/lib/league-manager-ledger";
import { captureLeagueDraftSelections } from "@/lib/league-draft-selections";
import { syncLeagueMatchups } from "@/lib/league-matchups";

/* ---------------------------------------------------------------------- */
/* Fixtures                                                                */
/* ---------------------------------------------------------------------- */

const LEAGUE_ROW_ID = "league-row-1";
const SLEEPER_LEAGUE_ID = "sleeper-1";

function fakeSleeperLeague(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    league_id: SLEEPER_LEAGUE_ID,
    name: "Test League",
    season: "2026",
    sport: "nfl",
    status: "in_season",
    total_rosters: 12,
    scoring_settings: { rec: 1 },
    roster_positions: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "BN", "BN"],
    settings: { leg: 3 },
    ...overrides,
  };
}

/* ---------------------------------------------------------------------- */
/* Fake Supabase client                                                    */
/* ---------------------------------------------------------------------- */

/**
 * A generic builder for the three simple upsert-and-prune tables
 * (rosters, league_users, league_drafts). All three share the same shape in
 * lib/league-pulse.ts: select().eq() as either a head count (when a Sleeper
 * cache hit needs to report existing counts) or a list read (the post-upsert
 * prune), upsert(), and delete().in().
 */
function rowTableBuilder(
  table: string,
  calls: string[],
  opts: { count?: number; listRows?: Array<Record<string, unknown>> },
) {
  return () => ({
    select: (_cols: string, selOpts?: { count?: string; head?: boolean }) => ({
      eq: () => {
        if (selOpts?.count) {
          calls.push(`${table}.count`);
          return Promise.resolve({ count: opts.count ?? 0, error: null });
        }
        calls.push(`${table}.select.prune`);
        return Promise.resolve({ data: opts.listRows ?? [], error: null });
      },
    }),
    upsert: () => {
      calls.push(`${table}.upsert`);
      return Promise.resolve({ error: null });
    },
    delete: () => ({
      in: () => {
        calls.push(`${table}.delete`);
        return Promise.resolve({ error: null });
      },
    }),
  });
}

function transactionsBuilder(
  calls: string[],
  opts: { latestWeekRow?: Record<string, unknown> | null; count?: number },
) {
  return () => ({
    select: (_cols: string, selOpts?: { count?: string; head?: boolean }) => {
      if (selOpts?.count) {
        return {
          eq: () => {
            calls.push("transactions.count");
            return Promise.resolve({ count: opts.count ?? 0, error: null });
          },
        };
      }
      // The "resume from the newest stored week" lookup:
      // select("week").eq().eq().not().order().limit().maybeSingle()
      return {
        eq: () => ({
          eq: () => ({
            not: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => {
                    calls.push("transactions.latestWeek");
                    return Promise.resolve({
                      data: opts.latestWeekRow ?? null,
                      error: null,
                    });
                  },
                }),
              }),
            }),
          }),
        }),
      };
    },
    upsert: () => {
      calls.push("transactions.upsert");
      return Promise.resolve({ error: null });
    },
  });
}

function makeFakeClient(
  opts: {
    cacheRow?: Record<string, unknown> | null;
    rosterCount?: number;
    userCount?: number;
    storedRosterRows?: Array<Record<string, unknown>>;
    storedUserRows?: Array<Record<string, unknown>>;
    storedDraftRows?: Array<Record<string, unknown>>;
    latestWeekRow?: Record<string, unknown> | null;
    transactionCount?: number;
    existingMetadata?: Record<string, unknown>;
    /**
     * What captureLeagueRawData's own read of `leagues` (status, leg,
     * playoff_week_start, last_scored_leg) returns. Defaults to a settled
     * league (status: "complete"), which makes playoffsStarted true without
     * needing leg/playoff_week_start set, matching the old unconditional
     * bracket-fetch behavior most of these tests were written against.
     */
    captureRow?: Record<string, unknown> | null;
    /**
     * What pulseLeagueFootprint's own read of `leagues.capture_completed_at`
     * returns when the core is a cache hit (the only case that read runs at
     * all). Defaults to an already-complete timestamp so tests that do not
     * care about this keep the pre-fix "cached core skips the capture set"
     * behavior; a test proving MPS's F8 fix passes null here.
     */
    captureCompletedAt?: string | null;
    /**
     * The `head: true` count captureLeagueRawData reads against
     * `league_matchups` when `includeMatchups: false` (the derived path),
     * to confirm a slate genuinely exists before trusting the skip.
     */
    matchupRowCount?: number;
  } = {},
) {
  const calls: string[] = [];
  const leagueUpdates: Array<Record<string, unknown>> = [];

  const leaguesBuilder = () => ({
    select: (cols: string) => {
      if (cols === "metadata") {
        return {
          eq: () => ({
            maybeSingle: () => {
              calls.push("leagues.select.metadata");
              return Promise.resolve({
                data: { metadata: opts.existingMetadata ?? {} },
                error: null,
              });
            },
          }),
        };
      }
      if (cols === "capture_completed_at") {
        return {
          eq: () => ({
            maybeSingle: () => {
              calls.push("leagues.select.captureCompletedAt");
              return Promise.resolve({
                data: {
                  capture_completed_at:
                    opts.captureCompletedAt === undefined
                      ? "2020-01-01T00:00:00.000Z"
                      : opts.captureCompletedAt,
                },
                error: null,
              });
            },
          }),
        };
      }
      if (cols.includes("last_scored_leg")) {
        return {
          eq: () => ({
            maybeSingle: () => {
              calls.push("leagues.select.captureStatus");
              return Promise.resolve({
                data: opts.captureRow ?? { status: "complete" },
                error: null,
              });
            },
          }),
        };
      }
      return {
        eq: () => ({
          maybeSingle: () => {
            calls.push("leagues.select.cache");
            return Promise.resolve({ data: opts.cacheRow ?? null, error: null });
          },
        }),
      };
    },
    upsert: () => ({
      select: () => ({
        single: () => {
          calls.push("leagues.upsert");
          return Promise.resolve({ data: { id: LEAGUE_ROW_ID }, error: null });
        },
      }),
    }),
    update: (payload: Record<string, unknown>) => {
      let label = "leagues.update.other";
      if (payload.pulse_status === "syncing") label = "leagues.update.syncing";
      else if (payload.pulse_status === "complete") label = "leagues.update.stamp";
      else if ("metadata" in payload) label = "leagues.update.brackets";
      else if ("capture_completed_at" in payload || "capture_error" in payload)
        label = "leagues.update.capture";
      calls.push(label);
      leagueUpdates.push(payload);
      return { eq: () => Promise.resolve({ error: null }) };
    },
  });

  const client = {
    from: (table: string) => {
      if (table === "leagues") return leaguesBuilder();
      if (table === "rosters")
        return rowTableBuilder("rosters", calls, {
          count: opts.rosterCount,
          listRows: opts.storedRosterRows,
        })();
      if (table === "league_users")
        return rowTableBuilder("league_users", calls, {
          count: opts.userCount,
          listRows: opts.storedUserRows,
        })();
      if (table === "league_drafts")
        return rowTableBuilder("league_drafts", calls, {
          listRows: opts.storedDraftRows,
        })();
      if (table === "league_transactions")
        return transactionsBuilder(calls, {
          latestWeekRow: opts.latestWeekRow,
          count: opts.transactionCount,
        })();
      if (table === "league_matchups") {
        return {
          select: (_cols: string, _selOpts?: { count?: string; head?: boolean }) => ({
            eq: () => ({
              eq: () => {
                calls.push("league_matchups.count");
                return Promise.resolve({ count: opts.matchupRowCount ?? 0, error: null });
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table in test stub: ${table}`);
    },
  };

  return { client: client as never, calls, leagueUpdates };
}

/** Wires the Sleeper mocks to a clean, empty-roster first sync. */
function wireFirstSyncPipeline(overrides: { league?: Partial<Record<string, unknown>> } = {}) {
  vi.mocked(getSleeperLeague).mockResolvedValue(fakeSleeperLeague(overrides.league) as never);
  vi.mocked(getSleeperRosters).mockResolvedValue([]);
  vi.mocked(getSleeperLeagueUsers).mockResolvedValue([]);
  vi.mocked(getSleeperTradedPicks).mockResolvedValue([]);
  vi.mocked(getSleeperLeagueDrafts).mockResolvedValue([]);
  vi.mocked(getAllSleeperTransactions).mockResolvedValue([]);
  vi.mocked(getSleeperWinnersBracket).mockResolvedValue([]);
  vi.mocked(getSleeperLosersBracket).mockResolvedValue([]);
  vi.mocked(getNflState).mockResolvedValue(null);
  vi.mocked(syncLeagueMatchups).mockResolvedValue({
    ok: true,
    weeksFetched: [],
    rowsWritten: 0,
    failedWeeks: [],
    noScheduleYet: false,
  } as never);
  vi.mocked(captureLeagueDraftSelections).mockResolvedValue({
    draftsConsidered: 0,
    draftsCaptured: 0,
    picksWritten: 0,
    fetchFailures: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------------- */
/* What it runs, and what it deliberately does not                        */
/* ---------------------------------------------------------------------- */

describe("pulseLeagueFootprint: scope", () => {
  it("captures the league, its transactions, and its brackets, and never touches the expensive per-league computes", async () => {
    wireFirstSyncPipeline();
    vi.mocked(getAllSleeperTransactions).mockResolvedValue([
      {
        transaction_id: "t1",
        type: "waiver",
        status: "complete",
        adds: {},
        drops: {},
        draft_picks: [],
        waiver_budget: [],
        roster_ids: [1],
        created: Date.now(),
        leg: 3,
      } as never,
    ]);
    vi.mocked(getSleeperWinnersBracket).mockResolvedValue([
      { m: 1, r: 1, t1: 1, t2: 2, w: 1, l: 2, p: 1 },
    ] as never);
    vi.mocked(getSleeperLosersBracket).mockResolvedValue([]);

    const { client } = makeFakeClient({ cacheRow: null, transactionCount: 1 });

    const result = await pulseLeagueFootprint(client, SLEEPER_LEAGUE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cached).toBe(false);
    expect(result.counts.transactions).toBe(1);

    // What it runs.
    expect(getSleeperLeague).toHaveBeenCalledWith(SLEEPER_LEAGUE_ID);
    expect(getAllSleeperTransactions).toHaveBeenCalled();
    expect(getSleeperWinnersBracket).toHaveBeenCalledWith(SLEEPER_LEAGUE_ID);
    expect(getSleeperLosersBracket).toHaveBeenCalledWith(SLEEPER_LEAGUE_ID);
    expect(captureLeagueDraftSelections).toHaveBeenCalled();
    expect(syncLeagueMatchups).toHaveBeenCalled();

    // What it must never run. This is the whole point of the function: a
    // full pulseLeague also computes these, and Manager Pulse queuing forty
    // of them would spend most of an hour of compute nobody asked for.
    expect(calculateLeaguePowerRankings).not.toHaveBeenCalled();
    expect(refreshPowerPulse).not.toHaveBeenCalled();
    expect(refreshPositionalWar).not.toHaveBeenCalled();
    expect(refreshManagerLedger).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------- */
/* Cache hit: no Sleeper fetch at all                                      */
/* ---------------------------------------------------------------------- */

describe("pulseLeagueFootprint: fresh within the TTL", () => {
  it("short-circuits without contacting Sleeper, and skips the capture set entirely", async () => {
    wireFirstSyncPipeline();
    const { client } = makeFakeClient({
      cacheRow: {
        id: LEAGUE_ROW_ID,
        season: 2026,
        last_pulsed_at: new Date().toISOString(),
        pulse_status: "complete",
      },
      rosterCount: 10,
      userCount: 10,
      transactionCount: 5,
    });

    const result = await pulseLeagueFootprint(client, SLEEPER_LEAGUE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cached).toBe(true);
    expect(result.counts.transactions).toBe(5);

    expect(getSleeperLeague).not.toHaveBeenCalled();
    expect(getSleeperRosters).not.toHaveBeenCalled();
    expect(getAllSleeperTransactions).not.toHaveBeenCalled();
    expect(getSleeperWinnersBracket).not.toHaveBeenCalled();
    expect(getSleeperLosersBracket).not.toHaveBeenCalled();
    // The whole capture set is skipped on a cache hit, not just the
    // transaction and bracket stages: neither the draft-selection capture
    // nor the matchup slate (and the NFL-state read it needs) ever run.
    expect(captureLeagueDraftSelections).not.toHaveBeenCalled();
    expect(getNflState).not.toHaveBeenCalled();
    expect(syncLeagueMatchups).not.toHaveBeenCalled();
    expect(calculateLeaguePowerRankings).not.toHaveBeenCalled();
    expect(refreshPowerPulse).not.toHaveBeenCalled();
    expect(refreshPositionalWar).not.toHaveBeenCalled();
    expect(refreshManagerLedger).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------- */
/* F8: a cached core does not excuse a capture set that never completed   */
/* ---------------------------------------------------------------------- */

describe("pulseLeagueFootprint: cached core, incomplete capture set (F8)", () => {
  it("still takes the capture set when core is a cache hit but capture_completed_at is null", async () => {
    wireFirstSyncPipeline();
    vi.mocked(getSleeperWinnersBracket).mockResolvedValue([
      { m: 1, r: 1, t1: 1, t2: 2, w: 1, l: 2, p: 1 },
    ] as never);
    vi.mocked(getSleeperLosersBracket).mockResolvedValue([]);

    const { client } = makeFakeClient({
      cacheRow: {
        id: LEAGUE_ROW_ID,
        season: 2026,
        last_pulsed_at: new Date().toISOString(),
        pulse_status: "complete",
      },
      rosterCount: 10,
      userCount: 10,
      transactionCount: 5,
      // A prior pass captured the core rows but never finished the capture
      // set (a bracket or transaction stage failed). last_pulsed_at is
      // fresh, so core is a cache hit, but capture_completed_at is null.
      captureCompletedAt: null,
    });

    const result = await pulseLeagueFootprint(client, SLEEPER_LEAGUE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The core itself is still reported as cached: no league/roster/member
    // Sleeper calls were needed.
    expect(result.cached).toBe(true);
    expect(getSleeperLeague).not.toHaveBeenCalled();
    expect(getSleeperRosters).not.toHaveBeenCalled();

    // But the capture set runs anyway, because it never completed.
    expect(getAllSleeperTransactions).toHaveBeenCalled();
    expect(getSleeperWinnersBracket).toHaveBeenCalledWith(SLEEPER_LEAGUE_ID);
    expect(getSleeperLosersBracket).toHaveBeenCalledWith(SLEEPER_LEAGUE_ID);
    expect(captureLeagueDraftSelections).toHaveBeenCalled();
    expect(syncLeagueMatchups).toHaveBeenCalled();
  });

  it("skips the capture set on a cache hit whose capture_completed_at is already set", async () => {
    wireFirstSyncPipeline();
    const { client } = makeFakeClient({
      cacheRow: {
        id: LEAGUE_ROW_ID,
        season: 2026,
        last_pulsed_at: new Date().toISOString(),
        pulse_status: "complete",
      },
      rosterCount: 10,
      userCount: 10,
      transactionCount: 5,
      captureCompletedAt: new Date().toISOString(),
    });

    const result = await pulseLeagueFootprint(client, SLEEPER_LEAGUE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cached).toBe(true);
    expect(getAllSleeperTransactions).not.toHaveBeenCalled();
    expect(getSleeperWinnersBracket).not.toHaveBeenCalled();
    expect(syncLeagueMatchups).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------- */
/* A failed bracket request is never written as an empty bracket           */
/* ---------------------------------------------------------------------- */

describe("pulseLeagueFootprint: bracket null-vs-empty", () => {
  it("writes nothing to metadata when both bracket requests fail, and fails the job (incomplete capture set)", async () => {
    wireFirstSyncPipeline();
    vi.mocked(getSleeperWinnersBracket).mockResolvedValue(null);
    vi.mocked(getSleeperLosersBracket).mockResolvedValue(null);

    const { client, calls, leagueUpdates } = makeFakeClient({
      cacheRow: null,
      transactionCount: 0,
    });

    const result = await pulseLeagueFootprint(client, SLEEPER_LEAGUE_ID);

    // Since MPS-T016 the footprint job fails when the capture set is
    // incomplete (here: both bracket fetches failed), rather than reporting
    // success with brackets silently missing. The worker retries a failed
    // job; it never retries a "successful" one.
    expect(result.ok).toBe(false);
    // No read-modify-write of metadata happened at all: a failed fetch is
    // skipped outright rather than persisted as "no bracket".
    expect(calls).not.toContain("leagues.select.metadata");
    expect(calls).not.toContain("leagues.update.brackets");
    expect(leagueUpdates.some((u) => "metadata" in u)).toBe(false);
  });

  it("merges in the bracket that succeeded and leaves the other's prior value alone", async () => {
    wireFirstSyncPipeline();
    const freshWinners = [{ m: 1, r: 1, t1: 1, t2: 2, w: 1, l: 2, p: 1 }];
    vi.mocked(getSleeperWinnersBracket).mockResolvedValue(freshWinners as never);
    // The losers request failed this time. A prior value is already stored.
    vi.mocked(getSleeperLosersBracket).mockResolvedValue(null);

    const { client, leagueUpdates } = makeFakeClient({
      cacheRow: null,
      transactionCount: 0,
      existingMetadata: {
        settings: { leg: 2 },
        brackets: { losers: [{ m: 9, r: 1, t1: 5, t2: 6, w: 5, l: 6 }] },
      },
    });

    await pulseLeagueFootprint(client, SLEEPER_LEAGUE_ID);

    const bracketUpdate = leagueUpdates.find((u) => "metadata" in u);
    expect(bracketUpdate).toBeDefined();
    const metadata = bracketUpdate!.metadata as Record<string, unknown>;
    const brackets = metadata.brackets as Record<string, unknown>;
    // Fresh winners landed...
    expect(brackets.winners).toEqual(freshWinners);
    // ...and the losers bracket nobody could refetch this time was left
    // exactly as it was, not cleared to [] or dropped.
    expect(brackets.losers).toEqual([{ m: 9, r: 1, t1: 5, t2: 6, w: 5, l: 6 }]);
    // Sibling keys already on metadata (the raw Sleeper object's own fields)
    // were not clobbered by the merge.
    expect(metadata.settings).toEqual({ leg: 2 });
  });
});

/* ---------------------------------------------------------------------- */
/* Capture set completeness (MPS-T016)                                     */
/* ---------------------------------------------------------------------- */

describe("pulseLeagueFootprint: capture set completeness", () => {
  it("returns ok: false when the capture set is incomplete", async () => {
    wireFirstSyncPipeline();
    vi.mocked(getAllSleeperTransactions).mockRejectedValue(
      new Error(`Sleeper did not answer for week 1 of league ${SLEEPER_LEAGUE_ID}`),
    );

    const { client } = makeFakeClient({ cacheRow: null, transactionCount: 0 });

    const result = await pulseLeagueFootprint(client, SLEEPER_LEAGUE_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("capture set incomplete");
  });
});

/* ---------------------------------------------------------------------- */
/* Matchups completeness on the derived path (includeMatchups: false)      */
/* ---------------------------------------------------------------------- */

describe("captureLeagueRawData: matchups completeness when includeMatchups is false", () => {
  it("treats the set as incomplete when no matchup slate is stored for the season", async () => {
    wireFirstSyncPipeline();
    const { client, leagueUpdates } = makeFakeClient({
      captureRow: { status: "complete" },
      transactionCount: 0,
      matchupRowCount: 0,
    });

    const result = await captureLeagueRawData(
      client,
      { leagueRowId: LEAGUE_ROW_ID, sleeperLeagueId: SLEEPER_LEAGUE_ID, season: 2026 },
      { force: false, includeMatchups: false },
    );

    // The derived path never fetches from Sleeper for this stage: no
    // getNflState/syncLeagueMatchups call, just the bounded existence read.
    expect(getNflState).not.toHaveBeenCalled();
    expect(syncLeagueMatchups).not.toHaveBeenCalled();

    expect(result.matchups).toBe("failed");
    expect(result.complete).toBe(false);
    const captureUpdate = leagueUpdates.find(
      (u) => "capture_error" in u,
    ) as { capture_error?: string } | undefined;
    expect(captureUpdate?.capture_error).toContain("matchups");
    // Nothing else was actually wrong: only the missing slate should be named.
    expect(captureUpdate?.capture_error).not.toContain("transactions");
    expect(captureUpdate?.capture_error).not.toContain("draftSelections");
  });

  it("trusts the skip when a matchup slate already exists for the season", async () => {
    wireFirstSyncPipeline();
    const { client } = makeFakeClient({
      captureRow: { status: "complete" },
      transactionCount: 0,
      matchupRowCount: 4,
    });

    const result = await captureLeagueRawData(
      client,
      { leagueRowId: LEAGUE_ROW_ID, sleeperLeagueId: SLEEPER_LEAGUE_ID, season: 2026 },
      { force: false, includeMatchups: false },
    );

    expect(result.matchups).toBe("skipped");
    expect(result.complete).toBe(true);
  });
});

/* ---------------------------------------------------------------------- */
/* Transaction week cap (MPS-T037)                                        */
/* ---------------------------------------------------------------------- */

describe("pulseLeagueFootprint: transaction week cap", () => {
  it("caps the transaction walk at last_scored_leg + 1", async () => {
    wireFirstSyncPipeline();
    const { client } = makeFakeClient({
      cacheRow: null,
      transactionCount: 0,
      captureRow: {
        status: "in_season",
        leg: 17,
        playoff_week_start: 15,
        last_scored_leg: 17,
      },
    });

    await pulseLeagueFootprint(client, SLEEPER_LEAGUE_ID);

    expect(getAllSleeperTransactions).toHaveBeenCalledWith(SLEEPER_LEAGUE_ID, 18, 3, 0);
  });

  // MPS-T037's own prose and its code block disagreed on the fallback when
  // last_scored_leg is absent: the code said 25 unconditionally, the sentence
  // right after it said 18 for a settled league. Resolved toward the prose
  // (see the comment above syncTransactions in league-pulse.ts): a settled
  // league-season cannot have transactions past week 18, so walking to 25
  // there is wasted requests. An unsettled league keeps the wider ceiling.
  it("falls back to 18 when last_scored_leg is absent for a settled league", async () => {
    wireFirstSyncPipeline();
    // makeFakeClient's captureRow default is { status: "complete" }, i.e.
    // settled, which is exactly the case this resolution covers.
    const { client } = makeFakeClient({ cacheRow: null, transactionCount: 0 });

    await pulseLeagueFootprint(client, SLEEPER_LEAGUE_ID);

    expect(getAllSleeperTransactions).toHaveBeenCalledWith(SLEEPER_LEAGUE_ID, 18, 3, 0);
  });

  it("falls back to 25 when last_scored_leg is absent for an unsettled league", async () => {
    wireFirstSyncPipeline();
    const { client } = makeFakeClient({
      cacheRow: null,
      transactionCount: 0,
      captureRow: { status: "in_season" },
    });

    await pulseLeagueFootprint(client, SLEEPER_LEAGUE_ID);

    expect(getAllSleeperTransactions).toHaveBeenCalledWith(SLEEPER_LEAGUE_ID, 25, 3, 0);
  });
});

/* ---------------------------------------------------------------------- */
/* Write ordering: the core stamp lands before this function's own writes  */
/* ---------------------------------------------------------------------- */

describe("pulseLeagueFootprint: write ordering", () => {
  it("stamps last_pulsed_at/pulse_status=complete only after core's child rows persist, and before its own transaction and bracket writes", async () => {
    wireFirstSyncPipeline();
    vi.mocked(getSleeperRosters).mockResolvedValue([
      {
        roster_id: 1,
        owner_id: "u1",
        players: [],
        starters: [],
        reserve: [],
        taxi: [],
        co_owners: null,
        settings: {},
      } as never,
    ]);
    vi.mocked(getSleeperLeagueUsers).mockResolvedValue([
      {
        user_id: "u1",
        display_name: "Test Manager",
        avatar: null,
        is_owner: true,
        metadata: {},
      } as never,
    ]);
    vi.mocked(getAllSleeperTransactions).mockResolvedValue([
      {
        transaction_id: "t1",
        type: "waiver",
        status: "complete",
        adds: {},
        drops: {},
        draft_picks: [],
        waiver_budget: [],
        roster_ids: [1],
        created: Date.now(),
      } as never,
    ]);
    vi.mocked(getSleeperWinnersBracket).mockResolvedValue([
      { m: 1, r: 1, t1: 1, t2: 2, w: 1, l: 2, p: 1 },
    ] as never);
    vi.mocked(getSleeperLosersBracket).mockResolvedValue([]);

    const { client, calls } = makeFakeClient({
      cacheRow: null,
      storedRosterRows: [],
      storedUserRows: [],
      transactionCount: 1,
    });

    await pulseLeagueFootprint(client, SLEEPER_LEAGUE_ID);

    const rostersUpsertIdx = calls.indexOf("rosters.upsert");
    const usersUpsertIdx = calls.indexOf("league_users.upsert");
    const stampIdx = calls.indexOf("leagues.update.stamp");
    const transactionsUpsertIdx = calls.indexOf("transactions.upsert");
    const bracketsUpdateIdx = calls.indexOf("leagues.update.brackets");

    expect(rostersUpsertIdx).toBeGreaterThanOrEqual(0);
    expect(usersUpsertIdx).toBeGreaterThanOrEqual(0);
    expect(stampIdx).toBeGreaterThanOrEqual(0);
    expect(transactionsUpsertIdx).toBeGreaterThanOrEqual(0);
    expect(bracketsUpdateIdx).toBeGreaterThanOrEqual(0);

    // Core's own child rows land before the league counts as pulsed.
    expect(stampIdx).toBeGreaterThan(rostersUpsertIdx);
    expect(stampIdx).toBeGreaterThan(usersUpsertIdx);
    // The stamp is never deferred to after this function's own additional
    // writes: it reflects core being complete, not the footprint capture
    // being complete.
    expect(transactionsUpsertIdx).toBeGreaterThan(stampIdx);
    expect(bracketsUpdateIdx).toBeGreaterThan(stampIdx);
  });
});
