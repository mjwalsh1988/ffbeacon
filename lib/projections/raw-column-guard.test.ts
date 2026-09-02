/**
 * PE-T047: the raw-column guard.
 *
 * lib/projections/read.ts loadAdjustedProjections is the one path every
 * consumer of player_weekly_projections is meant to route through (see
 * docs/projection-engine-plan.md, section "3.9 Which source a reader gets").
 * A module that reads projected_pts_ppr / projected_pts_half_ppr /
 * projected_pts_std directly has stepped around that path, and the two
 * numbers on a page can start disagreeing the moment it does.
 *
 * Modeled on lib/positional-war/naming.test.ts: a crude, repo-wide string
 * scan is the only thing that will catch this drifting back in six months,
 * once nobody remembers this rule was ever written down.
 *
 * IF THIS TEST JUST FAILED ON YOUR CHANGE:
 *   1. Can the module route through lib/projections/read.ts
 *      loadAdjustedProjections instead of selecting the column itself? That is
 *      almost always the right fix. Pass the scoring map you already have, or
 *      null if you genuinely have none (see PE-T042 to PE-T046 for four worked
 *      examples of exactly this move).
 *   2. If the module has a real reason to read the source's raw published
 *      number rather than our adjusted opinion of it (grading a source
 *      against itself, a UI section that names the source and shows exactly
 *      what it published), add the file to ALLOWLIST below with a comment
 *      naming that reason. Do not add a file here just to make the test pass.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

/** The three denormalized columns every adjusted read must go through. */
const RAW_COLUMNS = ["projected_pts_ppr", "projected_pts_half_ppr", "projected_pts_std"];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

const SKIP_DIRECTORIES = new Set(["node_modules", ".next", ".git", "dist", "build"]);

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
    if (statSync(full).isDirectory()) {
      out.push(...walk(rel));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry))) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * The read path and the write paths that populate or grade the three
 * columns. Not "deliberately left raw" the way ALLOWLIST entries are: this is
 * the boundary the rest of the codebase reads and writes through, named
 * explicitly rather than inferred from a directory convention.
 */
const EXEMPT_FILES = new Set(
  [
    path.join("lib", "sync-weekly-projections.ts"),
    path.join("lib", "build-beacon-projections.ts"),
    path.join("lib", "calculate-projection-accuracy.ts"),
  ].map((p) => p.split("/").join(path.sep)),
);
const EXEMPT_DIR_PREFIX = path.join("lib", "projections") + path.sep;

function isExempt(file: string): boolean {
  return EXEMPT_FILES.has(file) || file.startsWith(EXEMPT_DIR_PREFIX);
}

/**
 * Every other file that legitimately touches one of the three columns, with
 * the reason it is here instead of routed through lib/projections/read.ts
 * loadAdjustedProjections. An unlisted file that matches is a real violation:
 * see the header above for what to do about one.
 */
const ALLOWLIST: Record<string, string> = {
  "lib/database.types.ts":
    "Generated Supabase types (CLAUDE.md: regenerated via MCP, never edited by hand). Declares the column names as part of the schema; it issues no query.",

  "lib/power-pulse/load.ts":
    "The canonical raw loader lib/projections/read.ts itself calls (loadProjections). It lives outside lib/projections/ because Power Pulse built it first: every adjusted read in the codebase, read.ts included, goes through this file's select before projectPlayerWeek adjusts the result.",

  "lib/breakdown/load-extras.ts":
    "Beacon Breakdown's own projection reader. Already routes every number through lib/power-pulse/project.ts projectPlayerWeek (its own header: 'ONE MODEL, NOT TWO'), the same adjustment engine lib/projections/read.ts calls; it predates that shared reader and selects its own raw rows rather than calling it. Not one of the PE-T042 to PE-T046 modules this task migrated.",

  "lib/on-the-clock/projection-board.ts":
    "On The Clock's full-draftable-pool sweep. Same situation as load-extras.ts above: every number is already adjusted via projectPlayerWeek, with its own bespoke paginated reader for the whole pool rather than a caller-supplied id list. Not one of the PE-T042 to PE-T046 modules.",

  "lib/positional-war/load.ts":
    "Positional WAR's full-universe projection loader, feeding lib/positional-war/engine.ts computeCurves(), which also runs every row through projectPlayerWeek per lib/positional-war's own module map. Same shape as the two entries above.",
  "lib/positional-war/load.test.ts":
    "Tests lib/positional-war/load.ts's raw row shape directly; allow-listed alongside it.",

  "lib/projection-scoreboard.ts":
    "The Part 5 grading scoreboard (PE-T052, /admin/projections): its own header says it is 'deliberately NOT a read of player_projection_accuracy' and instead grades 'has this source's raw number been close', which requires the raw published number per source, not our adjusted opinion of it.",

  "lib/sync-rookie-adp.ts":
    "Writes to player_market_snapshots (rookie ADP), a different table whose columns happen to share these names. Not a read of player_weekly_projections.",
  "lib/sync-rookie-adp.test.ts":
    "Tests the write in lib/sync-rookie-adp.ts above.",

  "lib/sync-sleeper-market.ts":
    "Writes to player_market_snapshots (market ADP sync), the same different table as lib/sync-rookie-adp.ts above.",

  "lib/player-profile.ts":
    "PE-T044: deliberately left raw. The profile's weekly-projections card and overview panel both name Sleeper as the source in the heading a reader sees ('Sleeper projected points' / 'Sleeper projections, {scoring} scoring'), and the per-stat beat/miss comparison grades Sleeper's own published number against what happened. See the comments above loadWeeklyProjections and loadProjectionsMap in that file.",

  "lib/build-beacon-projections.test.ts":
    "Tests the raw player_weekly_projections row shape lib/build-beacon-projections.ts itself reads and writes (that file is already EXEMPT_FILES above); allow-listed alongside it, matching lib/positional-war/load.test.ts above.",
};

function toRepoRelative(file: string): string {
  // Windows paths use "\"; the allow-list keys are written with "/" for
  // readability, so both directions of the comparison normalize to one form.
  return file.split(path.sep).join("/");
}

type Violation = { file: string; line: number; text: string };

/** Pure line scan, so the guard's own matching logic can be tested without a
 *  fixture file on disk (see "the guard itself works" below). */
function violationsInContent(file: string, content: string): Violation[] {
  const lines = content.split(/\r?\n/);
  const out: Violation[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const column of RAW_COLUMNS) {
      if (line.includes(column)) {
        out.push({ file, line: i + 1, text: line.trim() });
        break;
      }
    }
  }
  return out;
}

function rawColumnViolations(file: string): Violation[] {
  return violationsInContent(file, readFileSync(path.join(ROOT, file), "utf8"));
}

/**
 * Renders to the empty string when there is nothing to report, so a passing
 * run's `expect(...).toBe("")` reads cleanly. A failing run's message is the
 * violations themselves PLUS the instructions for what to do about them, so
 * the failure output alone is enough to act on without opening this file.
 */
function describeViolations(violations: Violation[]): string {
  if (violations.length === 0) return "";
  const lines = violations.map((v) => `${v.file}:${v.line}  ${v.text}`).join("\n");
  return (
    `${lines}\n\n` +
    `Found ${violations.length} unlisted read(s) of a raw projected points column. ` +
    `Route the file(s) above through lib/projections/read.ts loadAdjustedProjections ` +
    `instead of selecting the column directly, or add each one to ALLOWLIST in ` +
    `lib/projections/raw-column-guard.test.ts with a comment naming why it is a ` +
    `deliberate exception. Do not add a file to that list just to make this test pass.`
  );
}

describe("player_weekly_projections' points columns stay behind lib/projections/read.ts", () => {
  it("finds no unlisted file reading a raw projected points column", () => {
    const allowed = new Set(Object.keys(ALLOWLIST).map((p) => p.split("/").join(path.sep)));

    const files = walk("lib")
      .concat(walk("app"))
      .concat(walk("components"))
      .filter((f) => !isExempt(f) && !allowed.has(f) && !f.endsWith("raw-column-guard.test.ts"));

    const violations = files.flatMap((f) => rawColumnViolations(f));

    expect(describeViolations(violations)).toBe("");
  });

  it("every allow-listed file actually exists and still matches a raw column", () => {
    // The allow-list is a debt ledger. An entry for a file that no longer
    // touches the raw columns (because it was migrated later, or deleted) is
    // stale and should be removed, not carried forever.
    const missing: string[] = [];
    for (const rel of Object.keys(ALLOWLIST)) {
      const osPath = rel.split("/").join(path.sep);
      const full = path.join(ROOT, osPath);
      let content: string;
      try {
        content = readFileSync(full, "utf8");
      } catch {
        missing.push(`${rel} (file not found)`);
        continue;
      }
      if (!RAW_COLUMNS.some((c) => content.includes(c))) {
        missing.push(`${rel} (no longer references a raw projected points column)`);
      }
    }
    expect(missing.join("\n")).toBe("");
  });

  it("every allow-list reason is non-empty", () => {
    const empty = Object.entries(ALLOWLIST)
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([file]) => file);
    expect(empty).toEqual([]);
  });
});

describe("the guard itself works", () => {
  it("flags a raw column reference", () => {
    const violations = violationsInContent(
      "fake.ts",
      'const x = row["projected_pts_ppr"];',
    );
    expect(violations).toEqual([
      { file: "fake.ts", line: 1, text: 'const x = row["projected_pts_ppr"];' },
    ]);
  });

  it("flags all three raw columns, one violation per matching line", () => {
    const content = [
      "const a = row.projected_pts_ppr;",
      "const b = row.projected_pts_half_ppr;",
      "const c = row.projected_pts_std;",
      "const d = row.something_else;",
    ].join("\n");
    expect(violationsInContent("fake.ts", content)).toHaveLength(3);
  });

  it("does not flag a line with none of the three column names", () => {
    expect(violationsInContent("fake.ts", "const x = row.pts_ppr;")).toEqual([]);
  });

  it("recognizes an exempt path", () => {
    expect(isExempt(path.join("lib", "projections", "read.ts"))).toBe(true);
    expect(isExempt(path.join("lib", "sync-weekly-projections.ts"))).toBe(true);
    expect(isExempt(path.join("lib", "faab", "outlook.ts"))).toBe(false);
  });

  it("normalizes an allow-list key against a Windows-style relative path", () => {
    expect(toRepoRelative(path.join("lib", "player-profile.ts"))).toBe("lib/player-profile.ts");
  });
});
