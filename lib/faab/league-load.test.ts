import { describe, expect, it } from "vitest";

import {
  groupAuctions,
  loadLeagueValueContext,
  type AuctionTransactionRow,
} from "./league-load";

function waiverRow(
  over: Partial<AuctionTransactionRow> & { player?: string; roster?: number; bid?: number },
): AuctionTransactionRow {
  const { player = "4034", roster = 1, bid = 10, ...rest } = over;
  return {
    season: 2025,
    week: 3,
    type: "waiver",
    status: "complete",
    adds: { [player]: roster },
    roster_ids: [roster],
    metadata: { settings: { waiver_bid: bid } },
    ...rest,
  };
}

function lostRow(player: string, roster: number, bid: number): AuctionTransactionRow {
  return {
    season: 2025,
    week: 3,
    type: "waiver",
    status: "failed",
    adds: { [player]: roster },
    roster_ids: [roster],
    metadata: {
      settings: { waiver_bid: bid },
      metadata: { notes: "This player was claimed by another owner." },
    },
  };
}

describe("groupAuctions", () => {
  it("puts the winner and every losing bid in one auction, high to low", () => {
    const out = groupAuctions([
      waiverRow({ player: "4034", roster: 1, bid: 42 }),
      lostRow("4034", 2, 21),
      lostRow("4034", 3, 9),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].playerSleeperId).toBe("4034");
    expect(out[0].bids.map((b) => b.amount)).toEqual([42, 21, 9]);
    expect(out[0].bids.filter((b) => b.won)).toHaveLength(1);
    expect(out[0].bids[0].rosterId).toBe(1);
  });

  it("keeps a zero-dollar win, because a zero bid is a real bid", () => {
    const out = groupAuctions([waiverRow({ bid: 0 })]);
    expect(out).toHaveLength(1);
    expect(out[0].bids[0].amount).toBe(0);
  });

  it("drops failures that were never in the auction", () => {
    const rosterFull: AuctionTransactionRow = {
      ...lostRow("4034", 2, 30),
      metadata: {
        settings: { waiver_bid: 30 },
        metadata: { notes: "Unfortunately, your roster will have too many players." },
      },
    };
    const out = groupAuctions([waiverRow({ player: "4034", roster: 1, bid: 5 }), rosterFull]);
    expect(out[0].bids).toHaveLength(1);
  });

  it("ignores a group with no winner", () => {
    expect(groupAuctions([lostRow("4034", 2, 30), lostRow("4034", 3, 10)])).toEqual([]);
  });

  it("ignores a group with two winners, rather than guessing which one priced it", () => {
    const out = groupAuctions([
      waiverRow({ player: "4034", roster: 1, bid: 12 }),
      waiverRow({ player: "4034", roster: 2, bid: 8 }),
    ]);
    expect(out).toEqual([]);
  });

  it("skips transactions that add more than one player", () => {
    const multi: AuctionTransactionRow = {
      ...waiverRow({}),
      adds: { "4034": 1, "5000": 1 },
    };
    expect(groupAuctions([multi])).toEqual([]);
  });

  it("separates the same player in different weeks and seasons", () => {
    const out = groupAuctions([
      waiverRow({ week: 3, bid: 10 }),
      waiverRow({ week: 4, bid: 20 }),
      waiverRow({ season: 2024, week: 3, bid: 30 }),
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((a) => a.season)).toEqual([2024, 2025, 2025]);
  });

  it("ignores non-waiver transactions", () => {
    expect(groupAuctions([{ ...waiverRow({}), type: "free_agent" }])).toEqual([]);
  });
});

type LeagueRow = {
  format_config_id: string | null;
  metadata: unknown;
  format_configs: { league_type?: string | null } | null;
};

function clientReturning(row: LeagueRow | null) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: row }),
              };
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function leagueRow(sleeperType: number | null, leagueType: string | null = null): LeagueRow {
  return {
    format_config_id: "fmt",
    metadata: sleeperType === null ? {} : { settings: { type: sleeperType } },
    format_configs: leagueType ? { league_type: leagueType } : null,
  };
}

describe("loadLeagueValueContext keeper detection", () => {
  it("reads redraft as not keeper", async () => {
    const out = await loadLeagueValueContext(clientReturning(leagueRow(0)), "l1");
    expect(out.isKeeperLeague).toBe(false);
  });

  it("reads keeper and dynasty as keeper", async () => {
    expect((await loadLeagueValueContext(clientReturning(leagueRow(1)), "l1")).isKeeperLeague).toBe(
      true,
    );
    expect((await loadLeagueValueContext(clientReturning(leagueRow(2)), "l1")).isKeeperLeague).toBe(
      true,
    );
  });

  it("reads chopped as NOT keeper: nobody keeps anybody in a one-season elimination league", async () => {
    const out = await loadLeagueValueContext(clientReturning(leagueRow(3)), "l1");
    expect(out.isKeeperLeague).toBe(false);
  });

  it("lets a derived dynasty format win over a missing Sleeper type", async () => {
    const out = await loadLeagueValueContext(clientReturning(leagueRow(null, "dynasty")), "l1");
    expect(out.isKeeperLeague).toBe(true);
  });

  it("returns no format when the league is missing", async () => {
    const out = await loadLeagueValueContext(clientReturning(null), "l1");
    expect(out).toEqual({ formatConfigId: null, isKeeperLeague: false });
  });
});
