import { describe, it, expect } from "vitest";
import {
  extractRookieRankings,
  buildMergeNameToSleeper,
  resolveRookie,
  buildRookieInsert,
  seasonForScrapeDate,
  ROOKIE_ADP_SOURCE,
  ROOKIE_ADP_KEY,
  type RookieRankingRow,
  type PlayerLookup,
} from "./sync-rookie-adp";

// Minimal db_fpecr_latest.csv-shaped records. Only the columns the sync reads
// need to be present; the real file carries ~25 columns.
function rec(over: Record<string, string>): Record<string, string> {
  return {
    page_type: "dynasty-rk",
    ecr: "1",
    mergename: "player",
    pos: "RB",
    team: "ARI",
    player: "Player",
    scrape_date: "2026-07-03",
    ...over,
  };
}

describe("seasonForScrapeDate", () => {
  it("maps a mid-year scrape to that calendar year", () => {
    expect(seasonForScrapeDate("2026-07-03")).toBe(2026);
  });
  it("rolls January/February back to the prior season", () => {
    expect(seasonForScrapeDate("2026-02-15")).toBe(2025);
    expect(seasonForScrapeDate("2026-03-01")).toBe(2026);
  });
  it("returns null on a malformed date", () => {
    expect(seasonForScrapeDate("not-a-date")).toBeNull();
    expect(seasonForScrapeDate("")).toBeNull();
  });
});

describe("extractRookieRankings", () => {
  it("keeps only dynasty-rk rows", () => {
    const rows = extractRookieRankings([
      rec({ page_type: "dynasty-overall", mergename: "somevet", ecr: "5" }),
      rec({ page_type: "dynasty-rk", mergename: "jeremiyah love", pos: "RB", ecr: "1" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].mergeName).toBe("jeremiyah love");
    expect(rows[0].ecr).toBe(1);
  });

  it("de-duplicates the doubled rows, keeping the best (lowest) ecr", () => {
    const rows = extractRookieRankings([
      rec({ mergename: "carnell tate", pos: "WR", ecr: "3.4" }),
      rec({ mergename: "carnell tate", pos: "WR", ecr: "2.0" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ecr).toBe(2.0);
  });

  it("drops rows missing ecr / mergename / scrape_date", () => {
    const rows = extractRookieRankings([
      rec({ mergename: "", ecr: "1" }),
      rec({ mergename: "a", ecr: "" }),
      rec({ mergename: "b", ecr: "0" }),
      rec({ mergename: "c", scrape_date: "" }),
      rec({ mergename: "keep", ecr: "4" }),
    ]);
    expect(rows.map((r) => r.mergeName)).toEqual(["keep"]);
  });
});

describe("buildMergeNameToSleeper", () => {
  it("indexes by merge_name+position and name-only, skipping NA/empty ids", () => {
    const maps = buildMergeNameToSleeper([
      { merge_name: "Jeremiyah Love", position: "RB", sleeper_id: "13287" },
      { merge_name: "No Sleeper", position: "WR", sleeper_id: "NA" },
      { merge_name: "Empty", position: "TE", sleeper_id: "" },
    ]);
    expect(maps.withPos.get("jeremiyah love|RB")).toBe("13287");
    expect(maps.noPos.get("jeremiyah love")).toBe("13287");
    expect(maps.withPos.has("no sleeper|WR")).toBe(false);
    expect(maps.noPos.has("empty")).toBe(false);
  });
});

function rookieRow(over: Partial<RookieRankingRow> = {}): RookieRankingRow {
  return {
    mergeName: "jeremiyah love",
    position: "RB",
    player: "Jeremiyah Love",
    ecr: 1,
    scrapeDate: "2026-07-03",
    raw: { page_type: "dynasty-rk", mergename: "jeremiyah love" },
    ...over,
  };
}

const emptyPlayers: PlayerLookup = { bySleeperId: new Map(), byName: new Map() };

describe("resolveRookie", () => {
  it("resolves sleeper id via the crosswalk merge name, then player id", () => {
    const merge = buildMergeNameToSleeper([
      { merge_name: "Jeremiyah Love", position: "RB", sleeper_id: "13287" },
    ]);
    const players: PlayerLookup = {
      bySleeperId: new Map([["13287", "uuid-love"]]),
      byName: new Map(),
    };
    expect(resolveRookie(rookieRow(), merge, players)).toEqual({
      sleeperId: "13287",
      playerId: "uuid-love",
    });
  });

  it("falls back to the players name map when the crosswalk misses", () => {
    const merge = buildMergeNameToSleeper([]);
    const players: PlayerLookup = {
      bySleeperId: new Map(),
      byName: new Map([["jeremiyah love|RB", { id: "uuid-love", sleeperId: "13287" }]]),
    };
    expect(resolveRookie(rookieRow(), merge, players)).toEqual({
      sleeperId: "13287",
      playerId: "uuid-love",
    });
  });

  it("returns a null sleeper id when nothing matches (unstorable row)", () => {
    const merge = buildMergeNameToSleeper([]);
    expect(resolveRookie(rookieRow(), merge, emptyPlayers).sleeperId).toBeNull();
  });
});

describe("buildRookieInsert", () => {
  it("stores the ecr under the rookie adp key with the dynastyprocess source", () => {
    const insert = buildRookieInsert(rookieRow({ ecr: 3.4 }), 2026, "13287", "uuid-love", "2026-07-05T00:00:00.000Z");
    expect(insert.source).toBe(ROOKIE_ADP_SOURCE);
    expect(insert.season).toBe(2026);
    expect(insert.snapshot_date).toBe("2026-07-03");
    expect(insert.sleeper_player_id).toBe("13287");
    expect(insert.player_id).toBe("uuid-love");
    expect((insert.adp as Record<string, number>)[ROOKIE_ADP_KEY]).toBe(3.4);
    expect(insert.projected_pts_ppr).toBeNull();
  });

  it("keeps a null player_id (unmapped but real rookie still recorded)", () => {
    const insert = buildRookieInsert(rookieRow(), 2026, "13287", null, "2026-07-05T00:00:00.000Z");
    expect(insert.player_id).toBeNull();
    expect(insert.sleeper_player_id).toBe("13287");
  });
});
