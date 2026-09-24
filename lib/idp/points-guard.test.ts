/**
 * IDP-121: no defender module names a stored points column.
 *
 * A defender's pts_ppr, pts_half_ppr and pts_std are Sleeper's OFFENSIVE-only
 * figures (a linebacker's pts_ppr is his receptions and rushing, usually zero),
 * and pts_idp exists for 2025 only. Every defender figure in this product is
 * scored from his stat line under a named IDP scoring (lib/idp/stat-line.ts),
 * so a defender module that so much as names one of those columns is either
 * reading a meaningless number or about to.
 *
 * Modeled on lib/projections/raw-column-guard.test.ts. The rule is textual and
 * deliberately blunt: the scanned modules may not contain the column names at
 * all, in code or in comments. Test files are not scanned; they carry real
 * Sleeper payloads as fixtures, and a fixture is how the normaliser proves it
 * DROPS these keys.
 *
 * IF THIS TEST JUST FAILED ON YOUR CHANGE: score the defender from his stat line
 * with scoreIdpLine and a preset, or with the league's own scoring through the
 * normaliser. There is no allow-list here on purpose.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

/** The stored columns a defender module may never name. */
const POINTS_COLUMNS = ["pts_ppr", "pts_half_ppr", "pts_std", "pts_idp"];
const PATTERN = new RegExp(`\\b(${POINTS_COLUMNS.join("|")})\\b`);

/** Every module under lib/idp/, plus defender-prefixed profile modules and idp-prefixed guide modules. */
const ROOTS: { dir: string; accept: (basename: string) => boolean }[] = [
  { dir: path.join("lib", "idp"), accept: () => true },
  { dir: path.join("lib", "player-profile"), accept: (b) => b.startsWith("defender") },
  { dir: path.join("lib", "guides"), accept: (b) => b.startsWith("idp-") },
];

function walk(dir: string, accept: (basename: string) => boolean): string[] {
  const abs = path.join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(ROOT, rel)).isDirectory()) {
      out.push(...walk(rel, accept));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && accept(entry)) {
      out.push(rel);
    }
  }
  return out;
}

export function violationsIn(content: string): number[] {
  return content
    .split(/\r?\n/)
    .map((line, i) => (PATTERN.test(line) ? i + 1 : 0))
    .filter((n) => n > 0);
}

describe("defender modules never name a stored points column", () => {
  const files = ROOTS.flatMap((r) => walk(r.dir, r.accept));

  it("scans a non-empty set of files", () => {
    // Guards every assertion below from passing vacuously on a bad path.
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => f.split(path.sep).join("/"))).toContain("lib/idp/stat-line.ts");
  });

  it("finds no scanned module naming pts_ppr, pts_half_ppr, pts_std or pts_idp", () => {
    const offenders = files
      .map((f) => ({ file: f.split(path.sep).join("/"), lines: violationsIn(readFileSync(path.join(ROOT, f), "utf8")) }))
      .filter((v) => v.lines.length > 0)
      .map((v) => `${v.file}:${v.lines.join(",")}`);
    expect(offenders).toEqual([]);
  });

  it("the guard itself works", () => {
    expect(violationsIn("const x = row.pts_ppr;")).toEqual([1]);
    expect(violationsIn("a\nsum pts_idp here")).toEqual([2]);
    expect(violationsIn("const x = row.pts_ppr_total;")).toEqual([]);
    expect(violationsIn("keys starting pts_ are dropped")).toEqual([]);
  });
});
