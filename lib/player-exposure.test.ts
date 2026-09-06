import { describe, expect, it } from "vitest";
import {
  assignExposureRanks,
  compareExposure,
  searchExposureRows,
  type PlayerExposureRow,
} from "./player-exposure";

function row(over: Partial<PlayerExposureRow> = {}): PlayerExposureRow {
  return {
    sleeperPlayerId: "1",
    slug: "player-1",
    name: "Player One",
    position: "RB",
    team: "KC",
    leagueCount: 1,
    leagues: [
      { sleeperLeagueId: "L1", name: "Dynasty Warriors", avatar: null },
    ],
    sharePct: 100,
    rank: 1,
    tied: false,
    ...over,
  };
}

describe("assignExposureRanks", () => {
  it("numbers a list with no ties sequentially", () => {
    const ranked = assignExposureRanks([
      { leagueCount: 9 },
      { leagueCount: 6 },
      { leagueCount: 2 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked.every((r) => !r.tied)).toBe(true);
  });

  it("gives every member of a tie the same rank and skips the next one", () => {
    const ranked = assignExposureRanks([
      { leagueCount: 9 },
      { leagueCount: 8 },
      { leagueCount: 8 },
      { leagueCount: 8 },
      { leagueCount: 4 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 2, 5]);
    expect(ranked.map((r) => r.tied)).toEqual([false, true, true, true, false]);
  });

  it("marks a tie that opens the list", () => {
    const ranked = assignExposureRanks([
      { leagueCount: 5 },
      { leagueCount: 5 },
      { leagueCount: 1 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(ranked.map((r) => r.tied)).toEqual([true, true, false]);
  });

  it("handles an empty list", () => {
    expect(assignExposureRanks([])).toEqual([]);
  });

  it("leaves the rest of each row alone", () => {
    const [only] = assignExposureRanks([{ leagueCount: 3, name: "Nacua" }]);
    expect(only.name).toBe("Nacua");
  });
});

describe("compareExposure feeding assignExposureRanks", () => {
  it("produces ranks that follow the sort", () => {
    const rows = [
      row({ name: "Bijan", leagueCount: 4 }),
      row({ name: "Achane", leagueCount: 7 }),
      row({ name: "Chase", leagueCount: 4 }),
    ];
    rows.sort(compareExposure);
    const ranked = assignExposureRanks(rows);
    expect(ranked.map((r) => [r.name, r.rank, r.tied])).toEqual([
      ["Achane", 1, false],
      ["Bijan", 2, true],
      ["Chase", 2, true],
    ]);
  });
});

describe("searchExposureRows", () => {
  const rows = [
    row({
      sleeperPlayerId: "a",
      name: "Puka Nacua",
      position: "WR",
      team: "LAR",
      leagues: [
        { sleeperLeagueId: "L1", name: "Dynasty Warriors", avatar: null },
        { sleeperLeagueId: "L2", name: "Sunday Money", avatar: null },
      ],
    }),
    row({
      sleeperPlayerId: "b",
      name: "Bijan Robinson",
      position: "RB",
      team: "ATL",
      leagues: [
        { sleeperLeagueId: "L1", name: "Dynasty Warriors", avatar: null },
      ],
    }),
  ];

  it("returns every row untouched for an empty query", () => {
    const all = searchExposureRows(rows, "   ");
    expect(all).toHaveLength(2);
    expect(all.every((m) => !m.matchedPlayer && m.matchedLeagues === 0)).toBe(
      true,
    );
  });

  it("matches a player name, case insensitively", () => {
    const found = searchExposureRows(rows, "nacua");
    expect(found.map((m) => m.row.sleeperPlayerId)).toEqual(["a"]);
    expect(found[0].matchedPlayer).toBe(true);
  });

  it("matches position and team", () => {
    expect(searchExposureRows(rows, "RB").map((m) => m.row.name)).toEqual([
      "Bijan Robinson",
    ]);
    expect(searchExposureRows(rows, "lar").map((m) => m.row.name)).toEqual([
      "Puka Nacua",
    ]);
  });

  it("matches on league name and counts how many leagues hit", () => {
    const found = searchExposureRows(rows, "dynasty");
    expect(found).toHaveLength(2);
    expect(found.every((m) => !m.matchedPlayer)).toBe(true);
    expect(found.map((m) => m.matchedLeagues)).toEqual([1, 1]);
  });

  it("reports both when the query hits the player and a league", () => {
    const withLeague = [
      row({
        name: "Sunday Sunday",
        leagues: [
          { sleeperLeagueId: "L2", name: "Sunday Money", avatar: null },
        ],
      }),
    ];
    const [match] = searchExposureRows(withLeague, "sunday");
    expect(match.matchedPlayer).toBe(true);
    expect(match.matchedLeagues).toBe(1);
  });

  it("drops rows that hit nothing", () => {
    expect(searchExposureRows(rows, "zzzz")).toEqual([]);
  });

  it("tolerates a row with no position or team", () => {
    const sparse = [
      row({ name: "Unknown player 9999", position: null, team: null }),
    ];
    expect(searchExposureRows(sparse, "9999")).toHaveLength(1);
    expect(searchExposureRows(sparse, "wr")).toHaveLength(0);
  });
});
