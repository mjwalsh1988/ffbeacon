/**
 * No client component may VALUE-import from `lib/sleeper.ts`.
 *
 * Since the Sleeper call budget landed (MPS-T032), `lib/sleeper.ts` imports
 * `lib/sleeper-budget.ts`, which imports `node:async_hooks` so that three jobs
 * running at once can each count their own calls. Webpack cannot put a
 * `node:` scheme in a browser bundle, so a `"use client"` file that imports a
 * VALUE from `lib/sleeper.ts` fails the production build outright, with an
 * error that names async_hooks rather than the import that caused it. That is
 * a slow thing to diagnose and a trivial thing to prevent, and it will not be
 * caught by `tsc` or by any other test in this suite: only `next build` sees
 * it, and only at the very end.
 *
 * A TYPE-only import is fine and is deliberately allowed: `import type` is
 * erased before webpack ever sees the module, so it pulls nothing into the
 * bundle.
 *
 * The fix, when this test fails, is never to loosen it. It is to move the
 * value being imported into a pure module the way `currentNflSeason` was moved
 * to `lib/nfl-season.ts`, and to have `lib/sleeper.ts` re-export it so the
 * server side keeps one copy.
 *
 * Source-scanning, in the same style as `lib/positional-war/naming.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SCANNED_DIRS = ["app", "components"];
const IGNORED_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"]);

function collectFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectFiles(full, out);
      continue;
    }
    if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
}

/** The first non-empty, non-comment line, which is where a directive must be. */
function isClientModule(source: string): boolean {
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*") || line.startsWith("*")) continue;
    return line === '"use client";' || line === "'use client';";
  }
  return false;
}

/**
 * Every import statement that names `@/lib/sleeper` and is NOT `import type`.
 *
 * A named `import { type SleeperLeague } from "@/lib/sleeper"` is also erased,
 * but only when every specifier carries the `type` keyword, so the check below
 * treats a mixed import as a value import, which it is.
 */
function valueImportsSleeper(source: string): string[] {
  const found: string[] = [];
  // The clause may not itself contain `from`, or a lazy match would start at
  // an earlier import statement and swallow every one in between.
  const pattern = /import\s+((?:(?!\bfrom\b)[\s\S])*?)\s+from\s+["']@\/lib\/sleeper["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const clause = match[1].trim();
    if (clause.startsWith("type ")) continue;
    const specifiers = clause
      .replace(/^\{/, "")
      .replace(/\}$/, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const everySpecifierIsAType =
      specifiers.length > 0 && specifiers.every((s) => s.startsWith("type "));
    if (everySpecifierIsAType) continue;
    found.push(match[0].replace(/\s+/g, " "));
  }
  return found;
}

describe("client components and lib/sleeper", () => {
  const files: string[] = [];
  for (const dir of SCANNED_DIRS) collectFiles(path.join(ROOT, dir), files);

  it("finds files to scan", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no client component value-imports from @/lib/sleeper", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!isClientModule(source)) continue;
      for (const statement of valueImportsSleeper(source)) {
        offenders.push(`${path.relative(ROOT, file)}: ${statement}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lib/sleeper re-exports currentNflSeason rather than defining it", () => {
    const source = readFileSync(path.join(ROOT, "lib", "sleeper.ts"), "utf8");
    expect(source).toContain('export { currentNflSeason } from "./nfl-season"');
    expect(source).not.toContain("export function currentNflSeason");
  });

  it("lib/nfl-season.ts imports nothing", () => {
    const source = readFileSync(path.join(ROOT, "lib", "nfl-season.ts"), "utf8");
    expect(/^\s*import\s/m.test(source)).toBe(false);
  });
});
