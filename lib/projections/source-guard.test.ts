/**
 * The projection-source guard.
 *
 * Sibling of ./raw-column-guard.test.ts, and it closes the other half of the
 * same hole. That one stops a module reading `projected_pts_ppr` straight out
 * of the table. This one stops a module reading the RIGHT column from the
 * WRONG SOURCE.
 *
 * `loadProjections` and `loadAccuracy` in lib/power-pulse/load.ts both take an
 * optional `source` and both now fall back to Sleeper without it. That default
 * is a safety net, not a licence to omit the argument, and there are two
 * separate reasons an omitted source is a bug.
 *
 * The one this guard is named for: the day an admin flips
 * `beaconProjections.enabled`, every call site that omitted the argument keeps
 * quoting Sleeper's numbers while the ones beside it move onto ours. Two
 * totals for the same team on adjacent tabs, with nothing on either screen
 * saying why.
 *
 * The one that is worse, and that the default was added to stop: until
 * recently `loadProjections` applied NO filter when the argument was omitted.
 * Once ffbeacon rows exist beside sleeper rows, that returns two rows per
 * player-week, and its own completeness guard cannot catch it because the
 * count query was unfiltered too. A caller keying a Map by player id takes
 * whichever row arrived last; one pushing to an array doubles the universe.
 * The default now makes an omission merely stale rather than wrong, and this
 * guard is what stops it being either.
 *
 * So every call must name a source. Either a resolved one (from
 * resolveProjectionSourceForWindow in ./source.ts) or a deliberate literal,
 * and a file that does neither has to say why in ALLOWLIST below.
 *
 * IF THIS TEST JUST FAILED ON YOUR CHANGE:
 *   1. If you already hold the merged Power Pulse settings, resolve the source
 *      and pass it to both loads:
 *
 *        const projectionSource = await resolveProjectionSourceForWindow({
 *          supabase, season, fromWeek, settings: settings.beaconProjections,
 *        });
 *        loadProjections(supabase, ids, season, fromWeek, toWeek, projectionSource)
 *        loadAccuracy(supabase, ids, scoringBase, projectionSource)
 *
 *      It makes no query at all while the feature is disabled, so this is free
 *      today and correct the moment it is enabled.
 *   2. If the call genuinely wants Sleeper's own published number regardless
 *      of what a reader is shown elsewhere (grading a source against itself, a
 *      panel that names Sleeper in its heading), pass SLEEPER_SOURCE
 *      explicitly. Being explicit is the whole point; the guard is satisfied
 *      and the next reader can see the decision was made.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".next", ".git", "dist", "build"]);

/**
 * The two loaders whose `source` argument is optional and defaults to Sleeper.
 * `position` is which argument the source is, counting from zero.
 */
const GUARDED = [
  { fn: "loadProjections", position: 5 },
  { fn: "loadAccuracy", position: 3 },
] as const;

/**
 * Files that legitimately call one of these without naming a source.
 *
 * An entry is a debt ledger line, not a permanent exemption: it says the call
 * has been looked at and why it is still on the default. See the header for
 * what the two acceptable fixes are.
 */
const ALLOWLIST: Record<string, string> = {
  "lib/power-pulse/load.ts":
    "Declares both functions. Its own internal chunk helper forwards whatever the caller passed, so there is no call here to attribute a source to.",

  "lib/breakdown/load-extras.ts":
    "Declares a private loadAccuracyRows of its own that shares the name only by coincidence; it is not lib/power-pulse/load.ts's loadAccuracy. It DOES take a source now, resolved by loadBreakdownExtras and applied to all three of its projection reads, but this guard matches on the name rather than on the declaration so the entry stays.",

  "lib/draft-value/build.ts":
    "Declares a private loadAccuracy of its own (draft-board reliability rows), unrelated to lib/power-pulse/load.ts's. Its projection reads already route through lib/projections/read.ts loadAdjustedProjections, which resolves the source.",

  "lib/calculate-projection-accuracy.ts":
    "The WRITER of player_projection_accuracy. It declares a private loadProjections that reads every source on purpose, because its job is to grade each source against what happened. Filtering to one would make it unable to produce the ffbeacon rows the readers then scope to.",

  "lib/projection-scoreboard.ts":
    "The Part 5 grading scoreboard (/admin/projections). Declares its own loadProjections and deliberately reads every source: comparing them IS the page.",

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

export type SourceViolation = { file: string; line: number; fn: string; text: string };

/**
 * Split one call's argument list on top-level commas.
 *
 * Nested calls, object literals, array literals and template strings all
 * contain commas that are not argument separators, so a plain `split(",")`
 * would count `loadProjections(db, ids, season, week, week, src)` and
 * `loadProjections(db, [a, b], season, week)` as the same arity. Depth
 * counting over the three bracket pairs plus a quote state is enough: no call
 * site in this codebase puts an unbalanced bracket inside a string argument.
 */
export function splitTopLevelArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (quote) {
      current += ch;
      if (ch === "\\") {
        current += args[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) out.push(current.trim());
  return out;
}

/**
 * Every guarded call in `content` that stops short of the source argument.
 *
 * Whitespace is collapsed first so a call broken across lines reads the same
 * as one on a single line; the reported line number is the line the call
 * OPENS on, which is where a reader will look. A call whose closing paren is
 * not in the file (it never happens, but a truncated read would do it) is
 * skipped rather than guessed at.
 */
export function sourceViolationsIn(file: string, content: string): SourceViolation[] {
  const out: SourceViolation[] = [];
  for (const { fn, position } of GUARDED) {
    // `await loadProjections(`, `loadProjections(` and `PP.loadProjections(`
    // all match; `deriveLoadProjections(` does not. The `.` is deliberately NOT
    // excluded by the lookbehind: excluding it made a namespaced import
    // invisible, which is the other one-line way around this guard.
    const pattern = new RegExp(`(?<![\\w$])${fn}\\s*\\(`, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const open = match.index + match[0].length - 1;
      let depth = 0;
      let close = -1;
      let quote: string | null = null;
      for (let i = open; i < content.length; i += 1) {
        const ch = content[i];
        if (quote) {
          if (ch === "\\") i += 1;
          else if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          quote = ch;
          continue;
        }
        if (ch === "(") depth += 1;
        else if (ch === ")") {
          depth -= 1;
          if (depth === 0) {
            close = i;
            break;
          }
        }
      }
      if (close === -1) continue;

      const rawArgs = content.slice(open + 1, close);
      // A declaration, not a call: `function loadProjections(` and
      // `const loadProjections = async (` both reach here, and neither is a
      // call site with a source to name.
      const before = content.slice(Math.max(0, match.index - 24), match.index);
      if (/\b(function|const|let|var)\s*$/.test(before)) continue;

      const args = splitTopLevelArgs(rawArgs.replace(/\s+/g, " "));
      // A literal `undefined` in the source position is an omission written
      // out longhand: it reaches the loader as no argument at all. Counting it
      // as "named" is one of the two one-line ways around this guard.
      if (args.length > position && args[position] !== "undefined") continue;

      const line = content.slice(0, match.index).split(/\r?\n/).length;
      out.push({
        file,
        line,
        fn,
        text: `${fn}(${rawArgs.replace(/\s+/g, " ").trim()})`.slice(0, 160),
      });
    }
  }
  return out;
}

function describeViolations(violations: SourceViolation[]): string {
  if (violations.length === 0) return "";
  const lines = violations.map((v) => `${v.file}:${v.line}  ${v.text}`).join("\n");
  return (
    `${lines}\n\n` +
    `Found ${violations.length} call(s) that leave the projection source to default to Sleeper. ` +
    `Resolve one with resolveProjectionSourceForWindow (lib/projections/source.ts) and pass it, ` +
    `or pass SLEEPER_SOURCE explicitly if that is genuinely what the call wants, ` +
    `or add the file to ALLOWLIST in lib/projections/source-guard.test.ts with the reason. ` +
    `Do not add a file to that list just to make this test pass.`
  );
}

describe("every projection read names the source it is reading", () => {
  it("finds no unlisted call falling back to the Sleeper default", () => {
    const allowed = new Set(Object.keys(ALLOWLIST).map((p) => p.split("/").join(path.sep)));

    const files = walk("lib")
      .concat(walk("app"))
      .concat(walk("components"))
      .concat(walk("scripts"))
      .filter(
        (f) =>
          !allowed.has(f) &&
          !f.endsWith("source-guard.test.ts") &&
          // A test file mocks these functions rather than calling them for real.
          !f.endsWith(".test.ts") &&
          !f.endsWith(".test.tsx"),
      );

    const violations = files.flatMap((f) =>
      sourceViolationsIn(f, readFileSync(path.join(ROOT, f), "utf8")),
    );

    expect(describeViolations(violations)).toBe("");
  });

  it("every allow-listed file still exists and still mentions a guarded loader", () => {
    const missing: string[] = [];
    for (const rel of Object.keys(ALLOWLIST)) {
      const full = path.join(ROOT, rel.split("/").join(path.sep));
      let content: string;
      try {
        content = readFileSync(full, "utf8");
      } catch {
        missing.push(`${rel} (file not found)`);
        continue;
      }
      if (!GUARDED.some((g) => content.includes(g.fn))) {
        missing.push(`${rel} (no longer references a guarded loader)`);
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
  it("flags a loadProjections call with no source argument", () => {
    const found = sourceViolationsIn(
      "fake.ts",
      "const rows = await loadProjections(db, ids, season, week, week);",
    );
    expect(found).toHaveLength(1);
    expect(found[0].fn).toBe("loadProjections");
  });

  it("accepts a loadProjections call that names one", () => {
    expect(
      sourceViolationsIn(
        "fake.ts",
        "await loadProjections(db, ids, season, week, week, projectionSource);",
      ),
    ).toEqual([]);
  });

  it("accepts a call broken across several lines", () => {
    const content = [
      "await loadProjections(",
      "  db,",
      "  ids,",
      "  season,",
      "  currentWeek,",
      "  undefined,",
      "  projectionSource,",
      ");",
    ].join("\n");
    expect(sourceViolationsIn("fake.ts", content)).toEqual([]);
  });

  it("flags loadAccuracy without a source and accepts it with one", () => {
    expect(sourceViolationsIn("fake.ts", "loadAccuracy(db, ids, scoringBase);")).toHaveLength(1);
    expect(
      sourceViolationsIn("fake.ts", 'loadAccuracy(db, ids, scoringBase, "sleeper");'),
    ).toEqual([]);
  });

  it("does not count commas inside a nested call or array as argument separators", () => {
    // Four real arguments, one of which is an array holding two commas. A
    // naive split would read this as six and let it through.
    expect(
      sourceViolationsIn("fake.ts", "loadProjections(db, [a, b, c], season, week);"),
    ).toHaveLength(1);
  });

  it("ignores a declaration of the same name", () => {
    expect(
      sourceViolationsIn(
        "fake.ts",
        "async function loadProjections(supabase: X, ids: string[], season: number) {",
      ),
    ).toEqual([]);
  });

  it("does not match a longer identifier that ends with the guarded name", () => {
    expect(sourceViolationsIn("fake.ts", "myLoadProjections(db, ids, season, week);")).toEqual([]);
  });

  it("splits top-level arguments and nothing else", () => {
    expect(splitTopLevelArgs('a, { b: 1, c: 2 }, [d, e], f("g, h")')).toEqual([
      "a",
      "{ b: 1, c: 2 }",
      "[d, e]",
      'f("g, h")',
    ]);
  });
});

describe("the guard resists the two one-line ways around it", () => {
  it("flags an explicit undefined in the source position", () => {
    // Reaches the loader as no argument at all, so counting it as "named"
    // would let a caller opt out of the rule by typing one more word.
    expect(
      sourceViolationsIn(
        "fake.ts",
        "loadProjections(db, ids, season, week, week, undefined);",
      ),
    ).toHaveLength(1);
  });

  it("flags a namespaced call", () => {
    expect(
      sourceViolationsIn("fake.ts", "PP.loadProjections(db, ids, season, week);"),
    ).toHaveLength(1);
  });

  it("still ignores a longer identifier that merely ends with the name", () => {
    expect(sourceViolationsIn("fake.ts", "myLoadProjections(db, ids, season, week);")).toEqual(
      [],
    );
  });
});
