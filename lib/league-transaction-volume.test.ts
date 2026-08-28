/**
 * Cover for the per-team transaction counts behind the overview bar chart.
 *
 * The three counting rules are the whole feature. Getting any of them wrong
 * produces a chart that looks entirely plausible and is quietly wrong, which is
 * the reason each one has a test naming it.
 */

import { describe, expect, it } from "vitest";
import { loadTransactionVolume, rosterIdsOnRow } from "./league-transaction-volume";

type TxRow = {
  id: string;
  type: string;
  status: string | null;
  roster_ids: unknown;
};

type RosterRow = { sleeper_roster_id: number; owner_user_id: string | null };
type UserRow = {
  sleeper_user_id: string;
  display_name: string | null;
  team_name: string | null;
  avatar: string | null;
};

/**
 * A Supabase stand-in for the three tables this module reads. It honours
 * .range() so the paging path runs for real rather than being assumed, and it
 * counts the pages so a test can assert the loop stopped.
 */
function stub(txRows: TxRow[], rosters: RosterRow[], users: UserRow[]) {
  let pages = 0;
  const api = {
    pageCount: () => pages,
    from(table: string) {
      if (table === "rosters") {
        return { select: () => ({ eq: () => Promise.resolve({ data: rosters, error: null }) }) };
      }
      if (table === "league_users") {
        return { select: () => ({ eq: () => Promise.resolve({ data: users, error: null }) }) };
      }
      if (table === "league_transactions") {
        const chain = {
          eq: () => chain,
          order: () => chain,
          range: (from: number, to: number) => {
            pages += 1;
            return Promise.resolve({ data: txRows.slice(from, to + 1), error: null });
          },
        };
        return { select: () => chain };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return api as unknown as Parameters<typeof loadTransactionVolume>[0] & {
    pageCount: () => number;
  };
}

const ROSTERS: RosterRow[] = [
  { sleeper_roster_id: 1, owner_user_id: "u1" },
  { sleeper_roster_id: 2, owner_user_id: "u2" },
  { sleeper_roster_id: 3, owner_user_id: null },
];

const USERS: UserRow[] = [
  { sleeper_user_id: "u1", display_name: "BigBCardz", team_name: "Herbert The Pervert", avatar: "a1" },
  { sleeper_user_id: "u2", display_name: "BenMacleod27", team_name: null, avatar: null },
];

function tx(over: Partial<TxRow> & { id: string }): TxRow {
  return { type: "free_agent", status: "complete", roster_ids: [1], ...over };
}

describe("rosterIdsOnRow", () => {
  it("dedupes a roster that appears twice on one transaction", () => {
    expect(rosterIdsOnRow([2, 2, 5])).toEqual([2, 5]);
  });

  it("survives a malformed jsonb payload instead of throwing", () => {
    expect(rosterIdsOnRow(null)).toEqual([]);
    expect(rosterIdsOnRow("3")).toEqual([]);
    expect(rosterIdsOnRow([1, "2", null, "x"])).toEqual([1, 2]);
  });
});

describe("loadTransactionVolume", () => {
  it("counts a trade once for every roster it names", async () => {
    const volume = await loadTransactionVolume(
      stub([tx({ id: "t1", type: "trade", roster_ids: [1, 2] })], ROSTERS, USERS),
      "league-a",
    );
    const byRoster = new Map(volume.teams.map((t) => [t.sleeperRosterId, t]));
    expect(byRoster.get(1)?.total).toBe(1);
    expect(byRoster.get(2)?.total).toBe(1);
    // One ROW, so the league total is one, even though the teams sum to two.
    expect(volume.leagueTotal).toBe(1);
    expect(volume.leagueByType.trade).toBe(1);
  });

  it("counts league totals per row, not per side", async () => {
    // The tiles above the chart and the bars below it deliberately disagree.
    // If this ever reconciles, one of the two is counting the wrong thing.
    const volume = await loadTransactionVolume(
      stub(
        [
          tx({ id: "t1", type: "trade", roster_ids: [1, 2] }),
          tx({ id: "f1", type: "free_agent", roster_ids: [1] }),
        ],
        ROSTERS,
        USERS,
      ),
      "league-a",
    );
    expect(volume.leagueByType).toEqual({
      trade: 1,
      waiver: 0,
      freeAgent: 1,
      commissioner: 0,
      other: 0,
    });
    const sideTotal = volume.teams.reduce((n, t) => n + t.total, 0);
    expect(sideTotal).toBe(3);
    expect(volume.leagueTotal).toBe(2);
  });

  it("leaves failed waiver claims out and reports how many", async () => {
    const volume = await loadTransactionVolume(
      stub(
        [
          tx({ id: "w1", type: "waiver", status: "complete" }),
          tx({ id: "w2", type: "waiver", status: "failed" }),
          tx({ id: "w3", type: "waiver", status: "failed" }),
        ],
        ROSTERS,
        USERS,
      ),
      "league-a",
    );
    expect(volume.teams.find((t) => t.sleeperRosterId === 1)?.byType.waiver).toBe(1);
    expect(volume.leagueTotal).toBe(1);
    expect(volume.excludedFailed).toBe(2);
  });

  it("counts a roster once per transaction even when the row names it twice", async () => {
    const volume = await loadTransactionVolume(
      stub([tx({ id: "f1", roster_ids: [1, 1] })], ROSTERS, USERS),
      "league-a",
    );
    expect(volume.teams.find((t) => t.sleeperRosterId === 1)?.total).toBe(1);
  });

  it("keeps a team that has made no moves at all", async () => {
    const volume = await loadTransactionVolume(
      stub([tx({ id: "f1", roster_ids: [1] })], ROSTERS, USERS),
      "league-a",
    );
    expect(volume.teams).toHaveLength(3);
    expect(volume.teams.at(-1)?.total).toBe(0);
  });

  it("ignores a roster id with no roster row, rather than inventing a team", async () => {
    // A manager who left the league. Sleeper keeps the transaction.
    const volume = await loadTransactionVolume(
      stub([tx({ id: "f1", roster_ids: [1, 99] })], ROSTERS, USERS),
      "league-a",
    );
    expect(volume.teams).toHaveLength(3);
    expect(volume.leagueTotal).toBe(1);
  });

  it("orders busiest first, and breaks ties the same way on every load", async () => {
    const rows = [
      tx({ id: "a", roster_ids: [2] }),
      tx({ id: "b", roster_ids: [2] }),
      tx({ id: "c", roster_ids: [1] }),
    ];
    const first = await loadTransactionVolume(stub(rows, ROSTERS, USERS), "league-a");
    const second = await loadTransactionVolume(
      stub([...rows].reverse(), [...ROSTERS].reverse(), USERS),
      "league-a",
    );
    expect(first.teams.map((t) => t.sleeperRosterId)).toEqual([2, 1, 3]);
    expect(second.teams.map((t) => t.sleeperRosterId)).toEqual([2, 1, 3]);
  });

  it("names teams through the shared formatter, handle and all", async () => {
    const volume = await loadTransactionVolume(stub([], ROSTERS, USERS), "league-a");
    const byRoster = new Map(volume.teams.map((t) => [t.sleeperRosterId, t]));
    expect(byRoster.get(1)?.teamName).toBe("Herbert The Pervert");
    expect(byRoster.get(1)?.ownerLine).toBe("@BigBCardz");
    // No team name set, so the handle IS the name and printing it twice is
    // what ownerLine returning null prevents.
    expect(byRoster.get(2)?.teamName).toBe("@BenMacleod27");
    expect(byRoster.get(2)?.ownerLine).toBeNull();
    expect(byRoster.get(3)?.teamName).toBe("Team 3");
  });

  it("pages past the 1000-row select cap instead of stopping at it", async () => {
    // The busiest synced league already carries over 1500 transactions, and an
    // unpaged read would silently drop every one past the first thousand.
    const rows = Array.from({ length: 1500 }, (_, i) =>
      tx({ id: `t${i}`, roster_ids: [i % 2 === 0 ? 1 : 2] }),
    );
    const client = stub(rows, ROSTERS, USERS);
    const volume = await loadTransactionVolume(client, "league-a");
    expect(volume.leagueTotal).toBe(1500);
    expect(volume.teams.find((t) => t.sleeperRosterId === 1)?.total).toBe(750);
    expect(client.pageCount()).toBe(2);
  });
});
