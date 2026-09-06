import { describe, expect, it } from "vitest";
import {
  describeLeagueFilter,
  filterByLeagueQuery,
  matchesLeagueQuery,
  matchesLeagueType,
  presentLeagueCategories,
} from "./league-filter";

describe("matchesLeagueQuery", () => {
  it("matches an empty or whitespace query", () => {
    expect(matchesLeagueQuery("The Dynasty Room", "")).toBe(true);
    expect(matchesLeagueQuery("The Dynasty Room", "   ")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesLeagueQuery("The Dynasty Room", "DYNASTY")).toBe(true);
    expect(matchesLeagueQuery("THE DYNASTY ROOM", "dynasty")).toBe(true);
  });

  it("matches a partial word", () => {
    expect(matchesLeagueQuery("The Dynasty Room", "dyn")).toBe(true);
  });

  it("requires every term, in any order", () => {
    expect(matchesLeagueQuery("The Dynasty Room", "dyn room")).toBe(true);
    expect(matchesLeagueQuery("The Dynasty Room", "room dyn")).toBe(true);
    expect(matchesLeagueQuery("The Dynasty Room", "dyn keeper")).toBe(false);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(matchesLeagueQuery("The Dynasty Room", "  dynasty  ")).toBe(true);
  });

  it("does not match what is not there", () => {
    expect(matchesLeagueQuery("The Dynasty Room", "redraft")).toBe(false);
  });
});

describe("filterByLeagueQuery", () => {
  const leagues = [
    { name: "The Dynasty Room", season: "2026" },
    { name: "Office Redraft", season: "2026" },
    { name: "Superflex Keeper", season: "2025" },
  ];
  const text = (l: (typeof leagues)[number]) => `${l.name} ${l.season}`;

  it("returns everything for an empty query", () => {
    expect(filterByLeagueQuery(leagues, "", text)).toHaveLength(3);
    expect(filterByLeagueQuery(leagues, "  ", text)).toHaveLength(3);
  });

  it("returns a copy rather than the original array", () => {
    const out = filterByLeagueQuery(leagues, "", text);
    expect(out).not.toBe(leagues);
  });

  it("searches everything the row shows, not only the name", () => {
    expect(filterByLeagueQuery(leagues, "2025", text)).toHaveLength(1);
    expect(filterByLeagueQuery(leagues, "2026", text)).toHaveLength(2);
  });

  it("can return nothing", () => {
    expect(filterByLeagueQuery(leagues, "nothing here", text)).toEqual([]);
  });
});

describe("describeLeagueFilter", () => {
  it("states the plain total when nothing is typed", () => {
    expect(describeLeagueFilter(12, 12, "")).toBe("12 leagues.");
    expect(describeLeagueFilter(1, 1, "")).toBe("1 league.");
  });

  it("says how many of how many matched", () => {
    expect(describeLeagueFilter(3, 12, "dyn")).toBe(
      '3 of 12 leagues match "dyn".',
    );
  });

  it("says out loud when nothing matched, and against what", () => {
    expect(describeLeagueFilter(0, 12, "zzz")).toBe(
      'No leagues match "zzz". Showing none of 12.',
    );
  });
});

describe("presentLeagueCategories", () => {
  it("returns only the buckets actually present, in display order", () => {
    const rows = [
      { key: "redraft" as const },
      { key: "dynasty" as const },
      { key: "redraft" as const },
    ];
    // Dynasty leads the site's own display order, so it leads here too.
    expect(presentLeagueCategories(rows, (r) => r.key)).toEqual([
      "dynasty",
      "redraft",
    ]);
  });

  it("ignores rows that could not be classified", () => {
    const rows = [{ key: null }, { key: "dynasty" as const }];
    expect(presentLeagueCategories(rows, (r) => r.key)).toEqual(["dynasty"]);
  });

  it("is empty when nothing is classified", () => {
    expect(presentLeagueCategories([{ key: null }], (r) => r.key)).toEqual([]);
  });
});

describe("matchesLeagueType", () => {
  it("lets everything through on All", () => {
    expect(matchesLeagueType("dynasty", "all")).toBe(true);
    expect(matchesLeagueType(null, "all")).toBe(true);
  });

  it("keeps only the selected bucket", () => {
    expect(matchesLeagueType("dynasty", "dynasty")).toBe(true);
    expect(matchesLeagueType("redraft", "dynasty")).toBe(false);
  });

  it("drops an unclassified league from a specific bucket", () => {
    expect(matchesLeagueType(null, "dynasty")).toBe(false);
  });
});

describe("describeLeagueFilter with a type toggle", () => {
  it("names the type on its own", () => {
    expect(describeLeagueFilter(4, 12, "", "Dynasty")).toBe(
      "4 of 12 leagues are Dynasty.",
    );
  });

  it("names both halves when both are active", () => {
    expect(describeLeagueFilter(1, 12, "room", "Dynasty")).toBe(
      '1 of 12 leagues match "room" and are Dynasty.',
    );
  });

  it("says why nothing is showing", () => {
    expect(describeLeagueFilter(0, 12, "", "Best Ball Dynasty")).toBe(
      "No leagues are Best Ball Dynasty. Showing none of 12.",
    );
  });
});
