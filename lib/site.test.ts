/**
 * The position constants and the one position noun helper (plan IDP-102).
 *
 * The guard at the bottom exists because two copies of the same "QB means
 * quarterback" map drifted apart once already (BEAM had one returning the raw
 * code and one returning an empty string), and a third copy is exactly how a
 * defender ends up spoken as "LB" on one page and "linebacker" on the next.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IDP_POSITIONS,
  OFFENSE_POSITIONS,
  POSITIONS,
  isDefender,
  positionHeading,
  positionNoun,
  positionNounMap,
} from "./site";

describe("position constants", () => {
  it("keeps the six offensive positions under both names", () => {
    expect(OFFENSE_POSITIONS).toBe(POSITIONS);
    expect([...OFFENSE_POSITIONS]).toEqual(["QB", "RB", "WR", "TE", "K", "DEF"]);
  });

  it("lists the three individual defensive positions", () => {
    expect([...IDP_POSITIONS]).toEqual(["DL", "LB", "DB"]);
  });
});

describe("isDefender", () => {
  it("is true for DL, LB and DB in any case", () => {
    expect(isDefender("DL")).toBe(true);
    expect(isDefender("lb")).toBe(true);
    expect(isDefender("DB")).toBe(true);
  });

  it("is false for the team defense, offense and nothing", () => {
    expect(isDefender("DEF")).toBe(false);
    expect(isDefender("QB")).toBe(false);
    expect(isDefender(null)).toBe(false);
    expect(isDefender(undefined)).toBe(false);
    expect(isDefender("")).toBe(false);
  });
});

describe("positionNoun", () => {
  it("spells out every position in both forms", () => {
    expect(positionNoun("LB", "plural")).toBe("linebackers");
    expect(positionNoun("DL")).toBe("defensive lineman");
    expect(positionNoun("DL", "plural")).toBe("defensive linemen");
    expect(positionNoun("DB", "plural")).toBe("defensive backs");
    expect(positionNoun("QB")).toBe("quarterback");
    expect(positionNoun("DEF")).toBe("team defense");
    expect(positionNoun("te", "plural")).toBe("tight ends");
  });

  it("returns an unknown code as itself and nothing as nothing", () => {
    expect(positionNoun("OL")).toBe("OL");
    expect(positionNoun(null)).toBe("");
  });

  it("has a short style for the two positions that have one, and only them", () => {
    expect(positionNoun("WR", "singular", "short")).toBe("receiver");
    expect(positionNoun("DEF", "plural", "short")).toBe("defenses");
    expect(positionNoun("RB", "singular", "short")).toBe("running back");
    expect(positionNoun("LB", "plural", "short")).toBe("linebackers");
  });
});

describe("positionHeading and positionNounMap", () => {
  it("capitalises only the first letter", () => {
    expect(positionHeading("RB")).toBe("Running backs");
    expect(positionHeading("DEF", "singular")).toBe("Team defense");
    expect(positionHeading("DEF", "plural", "short")).toBe("Defenses");
    expect(positionHeading(null)).toBe("");
  });

  it("builds a map, with the short word for a listed position only", () => {
    expect(positionNounMap(["QB", "WR", "DEF"] as const, { short: ["DEF"] })).toEqual({
      QB: "quarterback",
      WR: "wide receiver",
      DEF: "defense",
    });
    expect(positionNounMap(["WR", "TE"] as const, { form: "plural", short: true, heading: true })).toEqual({
      WR: "Receivers",
      TE: "Tight ends",
    });
  });
});

const ROOTS = ["lib", "components", "app"];
/**
 * Files allowed to hold a position-to-English map: the helper, and nothing
 * else. The debt ledger recorded on 2026-09-24 (IDP-102) listed 19 older maps;
 * all were folded on 2026-09-25 into positionNoun, positionHeading and
 * positionNounMap, keeping each surface's wording (the short "receiver" and
 * "defense" forms live in lib/site.ts beside the full ones). A NEW file may not
 * join this list; use the helpers.
 */
const ALLOWED = new Map<string, string>([["lib/site.ts", "the helper"]]);

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
}

describe("one position noun map", () => {
  const root = join(__dirname, "..");
  const files: string[] = [];
  for (const r of ROOTS) walk(join(root, r), files);

  it("scans a non-empty set of files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("finds no second map from position codes to English nouns", () => {
    // A map entry like QB: "quarterback", LB: "linebacker" or DL: "Defensive
    // linemen", for any position the helper knows. A colour map or an order
    // map never has an English noun on the right. Widened on 2026-09-25: the
    // QB-only pattern missed two defensive-only maps in the IDP guide.
    const nouns = ["quarterback", "running back", "wide receiver", "tight end", "kicker", "team defense", "defensive linem[ae]n", "linebacker", "defensive back"];
    const pattern = new RegExp(
      `\\b(QB|RB|WR|TE|K|DEF|DL|LB|DB)\\s*:\\s*["'\`](${nouns.join("|")})s?["'\`]`,
      "i",
    );
    const offenders = files
      .map((f) => relative(root, f).replace(/\\/g, "/"))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => pattern.test(readFileSync(join(root, rel), "utf8")));
    expect(offenders).toEqual([]);
  });
});
