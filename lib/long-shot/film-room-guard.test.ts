/**
 * Owner decision 2, held by the code: Film Room is practice, and nothing it
 * produces is tallied, counted or streaked. Every call of incrementTally,
 * recordCompletion and applyCompletion inside lib/long-shot/ must sit in a
 * branch that checks for Hurry-Up within the 12 lines above it: either
 * `mode === "hurry_up"` or a query guarded `.eq("mode", "hurry_up")`.
 * The same string-match style as lib/projections/source-guard.test.ts.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "lib", "long-shot");
const CALLS = ["incrementTally", "recordCompletion", "applyCompletion"];
const GUARD = /mode === "hurry_up"|\.eq\("mode", "hurry_up"\)/;
const WINDOW = 12;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.startsWith("test-")) out.push(p);
  }
  return out;
}

function unguardedCalls(): string[] {
  const problems: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const fn of CALLS) {
        // A call, not the definition, an import or a comment.
        if (!new RegExp(`\\b${fn}\\(`).test(line)) continue;
        if (/^\s*(export\s+)?(async\s+)?function\b/.test(line) || /^\s*(import|\*|\/\/)/.test(line)) continue;
        const above = lines.slice(Math.max(0, i - WINDOW), i + 1).join("\n");
        if (!GUARD.test(above)) problems.push(`${file.slice(process.cwd().length + 1)}:${i + 1} ${fn}`);
      }
    });
  }
  return problems;
}

describe("film room guard", () => {
  it("every tally, completion and streak call sits behind a Hurry-Up check", () => {
    expect(unguardedCalls()).toEqual([]);
  });

  it("actually finds the calls it is guarding", () => {
    const all = sourceFiles(ROOT)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const fn of CALLS) expect(all).toMatch(new RegExp(`\\b${fn}\\(`));
  });
});
