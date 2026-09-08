/**
 * The Sleeper player lookup guard.
 *
 * Same shape and same purpose as `lib/sleeper-handle/guard.test.ts`: it stops a
 * second copy of a read that has to have exactly one.
 *
 * WHAT IT STOPS, AND WHY IT MATTERS MORE THAN IT LOOKS
 *
 * `players.external_ids->>'sleeper'` is indexed. `slug LIKE '%-4046'` is a
 * leading-wildcard pattern that no B-tree can serve. Put both in ONE PostgREST
 * `.or()` and the planner cannot use the index for EITHER half, so the query
 * sequentially scans the whole table. Measured on production
 * (docs/performance/site-speed-audit-and-plan.md, 4.1):
 *
 *   with the slug clause:    Seq Scan, 10,473 rows removed, 1,319.8 ms
 *   without the slug clause: BitmapOr on the index,             0.3 ms
 *
 * Six files carried a copy of this lookup. Two had already found the trap and
 * split the passes; four had not, and between them they put a full table scan
 * on the league overview's Teams section, the power rankings recompute, the
 * transactions feed and the player exposure panel. `players` had logged 81,321
 * sequential scans on 10,481 rows.
 *
 * Migration 0271 added `players.sleeper_slug_tail`, a stored generated column
 * carrying the numeric tail of the slug, with its own index, so the fallback
 * pass is now `.in("sleeper_slug_tail", missing)` and there is no reason for
 * the LIKE form to exist anywhere.
 *
 * IF THIS TEST JUST FAILED ON YOUR CHANGE:
 *   You want `resolveSleeperPlayers` from `lib/sleeper-player-lookup.ts`. It
 *   runs the indexed pass first and the slug-tail pass only for what is left,
 *   and both passes are index scans. If it does not return a column you need,
 *   widen it there once rather than writing a seventh copy here.
 *
 * An ALLOWLIST entry is a debt ledger line, never a way to pass the test.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
]);
const SEARCH_ROOTS = ["app", "components", "lib", "scripts"];

/**
 * The forbidden filter, as it appears in a PostgREST filter string.
 *
 * The `*` is PostgREST's wildcard, so this is the whole family: `slug.like.*-`,
 * `slug.ilike.*-`, and the same with a template hole after the hyphen.
 */
const FORBIDDEN = /slug\.i?like\.\*-/;

/**
 * Files allowed to name the pattern, with the reason each one does.
 *
 * Nothing is allowed to RUN it. Every entry below only mentions it in prose,
 * which the comment stripper already removes, so this list exists for the
 * second test rather than the first.
 */
const ALLOWLIST: Record<string, string> = {
  "lib/sleeper-player-lookup.ts":
    "The one lookup. Its header explains the trap; the code runs the indexed form.",
};

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const rel = path.join(dir, entry);
    const full = path.join(ROOT, rel);
    if (statSync(full).isDirectory()) out.push(...walk(rel));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry))) out.push(rel);
  }
  return out;
}

/** Posix-style so the allow-list keys read the same on every platform. */
function posix(rel: string): string {
  return rel.split(path.sep).join("/");
}

/** Block and line comments removed, so prose about the pattern does not count. */
export function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(): { rel: string; content: string }[] {
  const out: { rel: string; content: string }[] = [];
  for (const root of SEARCH_ROOTS) {
    for (const rel of walk(root)) {
      // This file names the pattern in order to forbid it.
      if (posix(rel) === "lib/players/sleeper-lookup-guard.test.ts") continue;
      out.push({
        rel: posix(rel),
        content: readFileSync(path.join(ROOT, rel), "utf8"),
      });
    }
  }
  return out;
}

describe("Sleeper player lookup guard", () => {
  it("has no file running the unindexable slug LIKE fallback", () => {
    const violations: string[] = [];
    for (const { rel, content } of sourceFiles()) {
      if (!FORBIDDEN.test(content)) continue;
      // A file may NAME the pattern in prose, and several usefully do: a
      // comment recording why the shape was abandoned is worth keeping. Only
      // CODE counts, so comments come out before the test.
      if (!FORBIDDEN.test(stripComments(content))) continue;
      violations.push(rel);
    }
    expect(
      violations,
      `These files run the leading-wildcard slug fallback, which forces a ` +
        `sequential scan of players. Use resolveSleeperPlayers from ` +
        `lib/sleeper-player-lookup.ts instead:\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps every allow-list entry pointing at a file that still exists", () => {
    const missing = Object.keys(ALLOWLIST).filter(
      (rel) => !sourceFiles().some((f) => f.rel === rel),
    );
    expect(
      missing,
      `Allow-list entries for files that are gone: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the one lookup reading the indexed generated column", () => {
    // The positive half of the guard. Without it, deleting the fallback
    // entirely would pass the test above while quietly dropping the recovery
    // path for a player Sleeper added since our last sync.
    const helper = readFileSync(
      path.join(ROOT, "lib", "sleeper-player-lookup.ts"),
      "utf8",
    );
    expect(stripComments(helper)).toContain('.in("sleeper_slug_tail"');
  });
});
