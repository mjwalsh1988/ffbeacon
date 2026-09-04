/**
 * Coverage for lib/manager-pulse/load.ts.
 *
 * This does not try to exercise every read; it targets the things that are
 * easy to get wrong per the module's own brief: PostgREST's silent 1000-row
 * truncation, `.in()` chunking at 200, the trade margin sign flip (the
 * highest-value test in this file, since a sign error there inverts every
 * trading figure downstream), and the several places a missing row must stay
 * absent rather than becoming an invented zero or an empty array.
 *
 * lib/league-signal-check.ts's analyzeLeagueTrades is mocked: it is owned by
 * another module and already has its own tests, and this file only needs to
 * verify what load.ts DOES with whatever that function returns.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";

const analyzeLeagueTrades = vi.fn();

vi.mock("@/lib/league-signal-check", () => ({
  analyzeLeagueTrades: (...args: unknown[]) => analyzeLeagueTrades(...args),
}));

const { loadManagerPulseInput } = await import("./load");

/* -------------------------------------------------------------------------- */
/* A generic Supabase mock: every method narrows an in-memory array; the      */
/* chain resolves either at `.range()` (paged reads) or when awaited         */
/* directly (a query with no `.range()` call, e.g. the `.or()` player map).   */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

function makeQueryBuilder(sourceRows: Row[]) {
  let result = sourceRows;
  // Loosely typed on purpose: this stands in for a PostgREST query builder
  // whose real type is a long generic chain that adds nothing here. Every
  // method narrows `result`; `.range()` resolves a page and `.then()` makes
  // the builder itself awaitable for chains that never call `.range()`.
  const builder: Record<string, (...args: never[]) => unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      result = result.filter((r) => r[col] === val);
      return builder;
    },
    in: (col: string, vals: unknown[]) => {
      result = result.filter((r) => vals.includes(r[col]));
      return builder;
    },
    order: () => builder,
    // The OR-clause player lookup is not parsed; tests that exercise it keep
    // the fixture scoped to exactly the rows that should match.
    or: () => builder,
    range: (from: number, to: number) => Promise.resolve({ data: result.slice(from, to + 1), error: null }),
    then: (
      onfulfilled?: ((v: { data: Row[]; error: null }) => unknown) | null,
    ) => Promise.resolve({ data: result, error: null }).then(onfulfilled ?? undefined),
  };
  return builder;
}

function fakeClient(tables: Record<string, Row[]>): SupabaseClient<Database> {
  return {
    from: (table: string) => makeQueryBuilder(tables[table] ?? []),
  } as unknown as SupabaseClient<Database>;
}

function baseParams(overrides: Partial<Parameters<typeof loadManagerPulseInput>[1]> = {}) {
  return {
    sleeperUserId: "user-1",
    handle: "TestManager",
    avatarUrl: null,
    seasonFrom: 2023,
    seasonTo: 2026,
    settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    leagueSeasons: [] as Array<{
      sleeperLeagueId: string;
      season: number;
      category: "dynasty" | "redraft" | "best-ball-dynasty" | "best-ball-redraft" | null;
      leagueName: string | null;
    }>,
    leagueSeasonsSkipped: 0,
    ...overrides,
  };
}

function leagueRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "league-row-1",
    sleeper_league_id: "sleeper-league-1",
    season: 2026,
    name: "Test League",
    status: "complete",
    total_rosters: 10,
    roster_positions: [],
    metadata: {},
    ...overrides,
  };
}

function rosterRow(overrides: Partial<Row> = {}): Row {
  return {
    league_id: "league-row-1",
    sleeper_roster_id: 1,
    owner_user_id: "someone-else",
    co_owners: [],
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
    ...overrides,
  };
}

afterEach(() => {
  analyzeLeagueTrades.mockReset();
});

describe("pagination past the 1000-row PostgREST cap", () => {
  it("issues a second request when the first page comes back full", async () => {
    const filler = Array.from({ length: 1000 }, (_, i) => rosterRow({ sleeper_roster_id: i + 100, owner_user_id: `filler-${i}` }));
    const targetRoster = rosterRow({ sleeper_roster_id: 999, owner_user_id: "user-1", wins: 7 });

    const client = fakeClient({
      leagues: [leagueRow()],
      rosters: [...filler, targetRoster],
    });

    const result = await loadManagerPulseInput(
      client,
      baseParams({
        leagueSeasons: [
          { sleeperLeagueId: "sleeper-league-1", season: 2026, category: "dynasty", leagueName: null },
        ],
      }),
    );

    // The manager's roster only exists on the 1001st row, past the first
    // 1000-row page. Finding it proves the second `.range()` request ran.
    expect(result.leagueSeasons).toHaveLength(1);
    expect(result.leagueSeasons[0].rosterId).toBe(999);
    expect(result.leagueSeasons[0].wins).toBe(7);
  });
});

describe("in() chunking at 200", () => {
  it("merges results across more than one 200-id chunk", async () => {
    const count = 250;
    const leagues: Row[] = [];
    const rosters: Row[] = [];
    const leagueSeasonsParam: Array<{
      sleeperLeagueId: string;
      season: number;
      category: "dynasty";
      leagueName: string | null;
    }> = [];

    for (let i = 0; i < count; i += 1) {
      const sleeperLeagueId = `sleeper-league-${i}`;
      leagues.push(
        leagueRow({ id: `league-row-${i}`, sleeper_league_id: sleeperLeagueId, season: 2026 }),
      );
      rosters.push(
        rosterRow({ league_id: `league-row-${i}`, sleeper_roster_id: 1, owner_user_id: "user-1" }),
      );
      leagueSeasonsParam.push({ sleeperLeagueId, season: 2026, category: "dynasty", leagueName: null });
    }

    const client = fakeClient({ leagues, rosters });
    const result = await loadManagerPulseInput(
      client,
      baseParams({ leagueSeasons: leagueSeasonsParam }),
    );

    // 250 ids only resolve fully if both the first 200-id chunk and the
    // trailing 50-id chunk were requested and merged.
    expect(result.leagueSeasons).toHaveLength(count);
  });
});

describe("trade margin sign, from the manager's own seat", () => {
  it("is negative when the manager is the losing side", async () => {
    const client = fakeClient({
      leagues: [leagueRow()],
      rosters: [
        rosterRow({ sleeper_roster_id: 1, owner_user_id: "user-1" }),
        rosterRow({ sleeper_roster_id: 2, owner_user_id: "user-2" }),
      ],
      league_users: [
        { league_id: "league-row-1", sleeper_user_id: "user-1", display_name: "Manager A" },
        { league_id: "league-row-1", sleeper_user_id: "user-2", display_name: "Manager B" },
      ],
      league_transactions: [
        {
          league_id: "league-row-1",
          sleeper_transaction_id: "txn-1",
          season: 2026,
          week: 3,
          type: "trade",
          status: "complete",
          // Player 9001 goes to roster 1 (the manager); player 9002 goes to
          // roster 2 (the counterparty, i.e. what the manager gave up).
          adds: { "9001": 1, "9002": 2 },
          drops: {},
          draft_picks: [],
          roster_ids: [1, 2],
          metadata: {},
          created_at_sleeper: "2026-10-01T00:00:00.000Z",
        },
      ],
      players: [
        { id: "player-a", external_ids: { sleeper: "9001" } },
        { id: "player-b", external_ids: { sleeper: "9002" } },
      ],
    });

    analyzeLeagueTrades.mockResolvedValue({
      enabled: true,
      formatDisplay: "Dynasty PPR Superflex",
      formatNotice: null,
      results: new Map([
        [
          "txn-1",
          {
            view: {
              winnerSide: "b", // roster 2, the counterparty, wins the trade
              marginPct: 12.5,
              verdictLabel: "Manager B wins",
              sides: [
                { side: "a", total: 100 },
                { side: "b", total: 130 },
              ],
              hasMissingValues: false,
              hasBlendedPicks: false,
              hasEstimatedPicks: false,
            },
            assetMeta: {
              a: [{ kind: "player", sleeperId: "9001", round: null }],
              b: [{ kind: "player", sleeperId: "9002", round: null }],
            },
            startup: null,
          },
        ],
      ]),
    });

    const result = await loadManagerPulseInput(
      client,
      baseParams({
        leagueSeasons: [
          { sleeperLeagueId: "sleeper-league-1", season: 2026, category: "dynasty", leagueName: null },
        ],
      }),
    );

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    // Roster 1 (the manager, side "a") lost, so the manager's own margin is
    // the NEGATIVE of the graded 12.5% margin, not the raw figure.
    expect(trade.marginPct).toBe(-12.5);
    expect(trade.valueIn).toBe(100);
    expect(trade.valueOut).toBe(130);
    expect(trade.incomingPlayerIds).toEqual(["player-a"]);
    expect(trade.outgoingPlayerIds).toEqual(["player-b"]);
  });

  it("is positive when the manager is the winning side", async () => {
    const client = fakeClient({
      leagues: [leagueRow()],
      rosters: [
        rosterRow({ sleeper_roster_id: 1, owner_user_id: "user-1" }),
        rosterRow({ sleeper_roster_id: 2, owner_user_id: "user-2" }),
      ],
      league_users: [],
      league_transactions: [
        {
          league_id: "league-row-1",
          sleeper_transaction_id: "txn-2",
          season: 2026,
          week: 3,
          type: "trade",
          status: "complete",
          adds: { "9001": 1, "9002": 2 },
          drops: {},
          draft_picks: [],
          roster_ids: [1, 2],
          metadata: {},
          created_at_sleeper: "2026-10-01T00:00:00.000Z",
        },
      ],
      players: [
        { id: "player-a", external_ids: { sleeper: "9001" } },
        { id: "player-b", external_ids: { sleeper: "9002" } },
      ],
    });

    analyzeLeagueTrades.mockResolvedValue({
      enabled: true,
      formatDisplay: "Dynasty PPR Superflex",
      formatNotice: null,
      results: new Map([
        [
          "txn-2",
          {
            view: {
              winnerSide: "a", // roster 1, the manager, wins
              marginPct: 9,
              verdictLabel: "Manager A wins",
              sides: [
                { side: "a", total: 140 },
                { side: "b", total: 110 },
              ],
              hasMissingValues: false,
              hasBlendedPicks: false,
              hasEstimatedPicks: false,
            },
            assetMeta: {
              a: [{ kind: "player", sleeperId: "9001", round: null }],
              b: [{ kind: "player", sleeperId: "9002", round: null }],
            },
            startup: null,
          },
        ],
      ]),
    });

    const result = await loadManagerPulseInput(
      client,
      baseParams({
        leagueSeasons: [
          { sleeperLeagueId: "sleeper-league-1", season: 2026, category: "dynasty", leagueName: null },
        ],
      }),
    );

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].marginPct).toBe(9);
  });
});

describe("ungraded trades", () => {
  it("are still included, with a null margin rather than a zero", async () => {
    const client = fakeClient({
      leagues: [leagueRow()],
      rosters: [
        rosterRow({ sleeper_roster_id: 1, owner_user_id: "user-1" }),
        rosterRow({ sleeper_roster_id: 2, owner_user_id: "user-2" }),
      ],
      league_transactions: [
        {
          league_id: "league-row-1",
          sleeper_transaction_id: "txn-3",
          season: 2026,
          week: 4,
          type: "trade",
          status: "complete",
          adds: { "9001": 1, "9002": 2 },
          drops: {},
          draft_picks: [],
          roster_ids: [1, 2],
          metadata: {},
          created_at_sleeper: "2026-10-08T00:00:00.000Z",
        },
      ],
      players: [
        { id: "player-a", external_ids: { sleeper: "9001" } },
        { id: "player-b", external_ids: { sleeper: "9002" } },
      ],
    });

    // Signal Check graded nothing for this league (e.g. format unresolved),
    // so the results map comes back empty.
    analyzeLeagueTrades.mockResolvedValue({
      enabled: true,
      formatDisplay: null,
      formatNotice: null,
      results: new Map(),
    });

    const result = await loadManagerPulseInput(
      client,
      baseParams({
        leagueSeasons: [
          { sleeperLeagueId: "sleeper-league-1", season: 2026, category: "dynasty", leagueName: null },
        ],
      }),
    );

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.marginPct).toBeNull();
    expect(trade.valueIn).toBeNull();
    expect(trade.valueOut).toBeNull();
    expect(trade.verdictLabel).toBeNull();
  });
});

describe("ledger absence", () => {
  it("leaves a league-season with no cache row out of ledgers, not present at zero", async () => {
    const client = fakeClient({
      leagues: [
        leagueRow({ id: "league-row-1", sleeper_league_id: "sleeper-league-1" }),
        leagueRow({ id: "league-row-2", sleeper_league_id: "sleeper-league-2" }),
      ],
      rosters: [
        rosterRow({ league_id: "league-row-1", sleeper_roster_id: 1, owner_user_id: "user-1" }),
        rosterRow({ league_id: "league-row-2", sleeper_roster_id: 5, owner_user_id: "user-1" }),
      ],
      // Only league-row-1 has a stored ledger row.
      league_manager_ledger_cache: [
        {
          league_id: "league-row-1",
          season: 2026,
          sleeper_roster_id: 1,
          weeks_graded: 10,
          lineup_efficiency: 0.9,
          waiver_moves: 2,
          waiver_hits: 1,
          waiver_faab_spent: 15,
          waiver_points_started: 40,
          waiver_points_on_roster: 55,
          wins_left_on_bench: 1,
          best_lineup_wins: 8,
          best_lineup_losses: 2,
          best_lineup_ties: 0,
          efficiency_rank: 2,
          scoring_rank: 3,
        },
      ],
    });

    const result = await loadManagerPulseInput(
      client,
      baseParams({
        leagueSeasons: [
          { sleeperLeagueId: "sleeper-league-1", season: 2026, category: "dynasty", leagueName: null },
          { sleeperLeagueId: "sleeper-league-2", season: 2026, category: "dynasty", leagueName: null },
        ],
      }),
    );

    expect(result.leagueSeasons).toHaveLength(2);
    expect(result.ledgers).toHaveLength(1);
    expect(result.ledgers[0].sleeperLeagueId).toBe("sleeper-league-1");
    expect(result.ledgers.some((l) => l.sleeperLeagueId === "sleeper-league-2")).toBe(false);
  });
});

describe("bracket absence", () => {
  it("gives null champion, runner-up and playoff ids when no bracket is stored, never empty arrays", async () => {
    const client = fakeClient({
      leagues: [leagueRow({ metadata: {} })], // no `brackets` key at all
      rosters: [rosterRow({ sleeper_roster_id: 1, owner_user_id: "user-1" })],
    });

    const result = await loadManagerPulseInput(
      client,
      baseParams({
        leagueSeasons: [
          { sleeperLeagueId: "sleeper-league-1", season: 2026, category: "dynasty", leagueName: null },
        ],
      }),
    );

    expect(result.leagueSeasons).toHaveLength(1);
    const season = result.leagueSeasons[0];
    expect(season.championRosterId).toBeNull();
    expect(season.runnerUpRosterId).toBeNull();
    expect(season.playoffRosterIds).toBeNull();
    expect(season.finish).toBeNull();
  });
});

describe("roster not found", () => {
  it("skips a league-season where the manager's roster cannot be matched", async () => {
    const client = fakeClient({
      leagues: [leagueRow()],
      rosters: [
        rosterRow({ sleeper_roster_id: 1, owner_user_id: "somebody-else", co_owners: [] }),
        rosterRow({ sleeper_roster_id: 2, owner_user_id: "another-person", co_owners: ["a-different-user"] }),
      ],
    });

    const result = await loadManagerPulseInput(
      client,
      baseParams({
        leagueSeasons: [
          { sleeperLeagueId: "sleeper-league-1", season: 2026, category: "dynasty", leagueName: null },
        ],
      }),
    );

    expect(result.leagueSeasons).toHaveLength(0);
  });

  it("still finds the roster when the manager is a co-owner rather than the primary owner", async () => {
    const client = fakeClient({
      leagues: [leagueRow()],
      rosters: [rosterRow({ sleeper_roster_id: 1, owner_user_id: "somebody-else", co_owners: ["user-1"] })],
    });

    const result = await loadManagerPulseInput(
      client,
      baseParams({
        leagueSeasons: [
          { sleeperLeagueId: "sleeper-league-1", season: 2026, category: "dynasty", leagueName: null },
        ],
      }),
    );

    expect(result.leagueSeasons).toHaveLength(1);
    expect(result.leagueSeasons[0].rosterId).toBe(1);
  });
});

describe("a league we do not hold", () => {
  it("is skipped entirely rather than appearing as a stub row", async () => {
    const client = fakeClient({ leagues: [], rosters: [] });

    const result = await loadManagerPulseInput(
      client,
      baseParams({
        leagueSeasons: [
          { sleeperLeagueId: "unknown-league", season: 2026, category: "dynasty", leagueName: null },
        ],
      }),
    );

    expect(result.leagueSeasons).toHaveLength(0);
  });
});

describe("never throws", () => {
  it("returns the empty shape when every read fails", async () => {
    const throwingClient = {
      from: () => ({
        select: () => {
          throw new Error("connection refused");
        },
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await loadManagerPulseInput(
      throwingClient,
      baseParams({
        leagueSeasons: [
          { sleeperLeagueId: "sleeper-league-1", season: 2026, category: "dynasty", leagueName: null },
        ],
      }),
    );

    expect(result.leagueSeasons).toEqual([]);
    expect(result.trades).toEqual([]);
    expect(result.sleeperUserId).toBe("user-1");
  });
});
