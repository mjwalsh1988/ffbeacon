import { describe, expect, it } from "vitest";
import { historyAnswerIds, historyNote, normalizeSearchName } from "./answers";
import { parseCsv, num } from "./csv";
import { franchiseFor, franchiseForModernCode } from "./franchises";
import { HOF_PROMINENCE, prominenceOf } from "./prominence";

describe("franchiseFor", () => {
  it("reads a code with its season", () => {
    expect(franchiseFor("BAL", 1970)?.key).toBe("colts");
    expect(franchiseFor("BAL", 2001)?.key).toBe("ravens");
    expect(franchiseFor("STL", 1985)?.key).toBe("cardinals");
    expect(franchiseFor("STL", 2001)?.key).toBe("rams");
    expect(franchiseFor("BOS", 1934)?.key).toBe("commanders");
    expect(franchiseFor("BOS", 1965)?.key).toBe("patriots");
    expect(franchiseFor("HOU", 1980)?.key).toBe("titans");
    expect(franchiseFor("HOU", 2010)?.key).toBe("texans");
    expect(franchiseFor("LA", 1955)?.key).toBe("rams");
    expect(franchiseFor("RAI", 1985)?.key).toBe("raiders");
    expect(franchiseFor("CHB", 1955)?.key).toBe("bears");
    // The 2002 to 2015 roster files use a second set of codes.
    expect(franchiseFor("CLV", 2010)?.key).toBe("browns");
    expect(franchiseFor("HST", 2010)?.key).toBe("texans");
    expect(franchiseFor("SL", 2010)?.key).toBe("rams");
    expect(franchiseFor("BLT", 2010)?.key).toBe("ravens");
    expect(franchiseFor("ARZ", 2010)?.key).toBe("cardinals");
    expect(franchiseFor("LA", 2020)?.key).toBe("rams");
    expect(franchiseFor("TEX", 1961)?.key).toBe("chiefs");
    expect(franchiseFor("COW", 1961)?.key).toBe("cowboys");
  });

  it("returns null for a defunct team", () => {
    expect(franchiseFor("AKR", 1920)).toBeNull();
    expect(franchiseFor("DAY", 1925)).toBeNull();
  });

  it("reads a present-day code without a season as the fallback", () => {
    expect(franchiseFor("LV", 1985)).toBeNull();
    expect(franchiseForModernCode("LV")?.key).toBe("raiders");
    expect(franchiseForModernCode("LA")?.key).toBe("rams");
    expect(franchiseForModernCode("ARI")?.key).toBe("cardinals");
    expect(franchiseForModernCode("AKR")).toBeNull();
  });
});

describe("prominenceOf", () => {
  const base = { hof: false, seasonsPlayed: 1, proBowls: 0, allPro: 0, draftRound: null, careerGames: 0 };
  it("is the ceiling for a Hall of Famer and near zero for a one-season player", () => {
    expect(prominenceOf({ ...base, hof: true })).toBe(HOF_PROMINENCE);
    expect(prominenceOf(base)).toBe(0);
    expect(prominenceOf({ ...base, seasonsPlayed: 2 })).toBeLessThan(0.1);
  });
  it("rises with seasons, honors and pedigree, and stays inside [0, 1]", () => {
    const starter = prominenceOf({ ...base, seasonsPlayed: 12, careerGames: 160 });
    const star = prominenceOf({ ...base, seasonsPlayed: 12, careerGames: 160, proBowls: 5, allPro: 3, draftRound: 1 });
    expect(starter).toBeGreaterThan(0.3);
    expect(star).toBeGreaterThan(starter);
    expect(star).toBeLessThanOrEqual(1);
  });
});

describe("historyAnswerIds", () => {
  it("answers under the players id only when linked and in the modern pool", () => {
    const pool = new Set(["m1"]);
    const out = historyAnswerIds(
      [
        { id: "h1", player_id: "m1" },
        { id: "h2", player_id: "m9" },
        { id: "h3", player_id: null },
        { id: "h1", player_id: "m1" },
      ],
      pool,
    );
    expect(out).toEqual(["m1", "h2", "h3"]);
  });
});

describe("normalizeSearchName and historyNote", () => {
  it("strips accents and punctuation", () => {
    expect(normalizeSearchName("  T.J.  Houshmandzadeh ")).toBe("t j houshmandzadeh");
    expect(normalizeSearchName("José Cortéz")).toBe("jose cortez");
  });
  it("says the years and up to two franchises", () => {
    expect(historyNote({ first_season: 1963, last_season: 1974, franchise_keys: ["bills", "raiders", "packers"] })).toBe(
      "1963 to 1974, Bills and Raiders",
    );
    expect(historyNote({ first_season: 1999, last_season: 1999, franchise_keys: [] })).toBe("1999");
  });
});

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, CRLF and NA", () => {
    const rows = parseCsv('a,b,c\r\n1,"x, y",NA\r\n2,"say ""hi""",3\r\n');
    expect(rows).toEqual([
      { a: "1", b: "x, y", c: "" },
      { a: "2", b: 'say "hi"', c: "3" },
    ]);
    expect(num(rows[1].c)).toBe(3);
    expect(num(rows[0].c)).toBe(0);
  });
});
