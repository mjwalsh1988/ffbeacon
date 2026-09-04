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

import { pulseLeagueFootprint } from "./league-pulse";
import {
  getSleeperLeague,
  getSleeperRosters,
  getSleeperLeagueUsers,
  getSleeperTradedPicks,
  getSleeperLeagueDrafts,
  getAllSleeperTransactions,
  getSleeperWinnersBracket,
  getSleeperLosersBracket,
} from "@/lib/sleeper";
import { calculateLeaguePowerRankings } from "@/lib/league-power-rankings";
import { refreshPowerPulse } from "@/lib/league-power-pulse";
import { refreshPositionalWar } from "@/lib/league-positional-war";
import { refreshManagerLedger } from "@/lib/league-manager-ledger";

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
  it("short-circuits without contacting Sleeper", async () => {
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
    expect(calculateLeaguePowerRankings).not.toHaveBeenCalled();
    expect(refreshPowerPulse).not.toHaveBeenCalled();
    expect(refreshPositionalWar).not.toHaveBeenCalled();
    expect(refreshManagerLedger).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------- */
/* A failed bracket request is never written as an empty bracket           */
/* ---------------------------------------------------------------------- */

describe("pulseLeagueFootprint: bracket null-vs-empty", () => {
  it("writes nothing to metadata when both bracket requests fail", async () => {
    wireFirstSyncPipeline();
    vi.mocked(getSleeperWinnersBracket).mockResolvedValue(null);
    vi.mocked(getSleeperLosersBracket).mockResolvedValue(null);

    const { client, calls, leagueUpdates } = makeFakeClient({
      cacheRow: null,
      transactionCount: 0,
    });

    const result = await pulseLeagueFootprint(client, SLEEPER_LEAGUE_ID);

    expect(result.ok).toBe(true);
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
