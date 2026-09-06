/**
 * The capture-set guard.
 *
 * captureLeagueRawData in lib/league-pulse.ts is THE CAPTURE SET: everything a
 * league sync writes beyond the core rows (transactions, the two playoff
 * brackets, draft selections, and for the footprint path the matchup slate),
 * whoever asked for the sync. Both callers that write beyond the core rows -
 * pulseLeagueDerived (a full pulseLeague) and pulseLeagueFootprint (the
 * lighter Manager Pulse capture) - must go through it, and nothing else may
 * call syncTransactions, captureLeagueBrackets or captureLeagueDraftSelections
 * directly. A second call site outside the capture set is exactly how a
 * league sync would end up racing the fields captureLeagueRawData reads to
 * decide applicability (status, leg, playoff_week_start, last_scored_leg) and
 * the leagues.capture_completed_at / capture_error columns it stamps.
 *
 * The rule is repo-wide, not file-local. captureLeagueDraftSelections is
 * declared in lib/league-draft-selections.ts, not here, so a scan limited to
 * league-pulse.ts alone would miss a second call site added to that file, or
 * to any other module under lib/. The call-site scan below walks every
 * .ts/.tsx file under lib/ rather than reading league-pulse.ts in isolation.
 *
 * This is a crude source-scanning guard, the same style as
 * lib/positional-war/naming.test.ts and lib/projections/source-guard.test.ts:
 * it reads files as text and counts brace-delimited function bodies / regex
 * call sites rather than parsing the AST. That is enough to catch the mistake
 * this guards against (a stage function called a second time from somewhere
 * new) without a parser dependency.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This test file lives directly in lib/, so its own directory IS the root of
// the scan.
const LIB_ROOT = __dirname;
const FILE = path.resolve(LIB_ROOT, "league-pulse.ts");
const source = readFileSync(FILE, "utf8");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".next", ".git", "dist", "build"]);

/**
 * Every .ts/.tsx file under lib/, as paths relative to lib/ (POSIX
 * separators, so a Windows checkout and a Linux one report the same strings).
 */
function walk(dir: string): string[] {
  const abs = path.join(LIB_ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const rel = dir === "." ? entry : `${dir}/${entry}`;
    const full = path.join(LIB_ROOT, rel);
    if (statSync(full).isDirectory()) out.push(...walk(rel));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry))) out.push(rel);
  }
  return out;
}

/**
 * The full text of one top-level function declared as
 * `[export] async function NAME(` in `source`, found by counting braces from
 * the first `{` after the declaration until they return to zero.
 */
function findMatchingParen(openParenIdx: number): number {
  let depth = 0;
  for (let i = openParenIdx; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("unbalanced parens while locating a function's parameter list");
}

/**
 * The function body's own opening brace, searched for starting just after the
 * parameter list's closing paren. A return type can itself contain braces
 * (an inline object literal type such as `Promise<{ transactions: number }>`),
 * so this is not simply the first "{" found: it is the first one that is not
 * nested inside a "<...>" generic.
 */
function findBodyOpenBrace(afterIdx: number): number {
  let angleDepth = 0;
  for (let i = afterIdx; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "<") angleDepth += 1;
    else if (ch === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (ch === "{" && angleDepth === 0) return i;
  }
  throw new Error("could not find a function body's opening brace");
}

function extractFunctionBody(name: string): string {
  const declRe = new RegExp(`^(export )?async function ${name}\\(`, "m");
  const match = declRe.exec(source);
  if (!match) {
    throw new Error(`could not find the declaration of ${name} in ${FILE}`);
  }
  // The parameter list can itself contain braces (an inline options type
  // literal), so the body's own opening brace is not simply the first "{"
  // after the declaration: it is the first "{" after the parameter list's
  // MATCHING closing paren.
  const openParenIdx = source.indexOf("(", match.index);
  const closeParenIdx = findMatchingParen(openParenIdx);
  const openBraceIdx = findBodyOpenBrace(closeParenIdx + 1);
  let depth = 0;
  let i = openBraceIdx;
  for (; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    throw new Error(`unbalanced braces while extracting ${name}`);
  }
  return source.slice(match.index, i + 1);
}

type CallSite = { file: string; line: number };

/**
 * Every call-site occurrence of `${name}(` across every .ts/.tsx file under
 * lib/, excluding a line that DECLARES the function
 * (`[export] async function NAME(`) in whichever file declares it.
 * `captureLeagueDraftSelections` is declared in
 * lib/league-draft-selections.ts, not in league-pulse.ts, so the exclusion is
 * checked per file rather than assumed to live only in the one file this
 * guard used to read alone.
 *
 * Test files are skipped: they mock these functions
 * (`captureLeagueDraftSelections: vi.fn()`) rather than call them for real,
 * the same exclusion lib/projections/source-guard.test.ts makes for the same
 * reason. A plain `import { NAME } from "..."` line never matches this
 * pattern either way, because nothing in an import list is followed
 * immediately by "(".
 */
function callSitesAcrossLib(name: string): CallSite[] {
  const declRe = new RegExp(`^(export )?async function ${name}\\(`);
  const callRe = new RegExp(`${name}\\(`);
  const out: CallSite[] = [];
  for (const file of walk(".")) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const text = readFileSync(path.join(LIB_ROOT, file), "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (declRe.test(line)) return;
      if (callRe.test(line)) out.push({ file, line: i + 1 });
    });
  }
  return out;
}

describe("captureLeagueRawData is the one door into the capture-set stages", () => {
  const derivedBody = extractFunctionBody("pulseLeagueDerived");
  const footprintBody = extractFunctionBody("pulseLeagueFootprint");
  const captureBody = extractFunctionBody("captureLeagueRawData");

  it("is called inside pulseLeagueDerived", () => {
    expect(derivedBody).toContain("captureLeagueRawData(");
  });

  it("is called inside pulseLeagueFootprint", () => {
    expect(footprintBody).toContain("captureLeagueRawData(");
  });

  it.each(["syncTransactions", "captureLeagueBrackets", "captureLeagueDraftSelections"])(
    "%s( appears exactly once across all of lib/ outside its own definition, and that call sits inside captureLeagueRawData",
    (name) => {
      const callSites = callSitesAcrossLib(name);
      const describeSites = callSites.map((s) => `${s.file}:${s.line}`).join(", ");
      expect(callSites.length, `call sites for ${name}(: ${describeSites || "none"}`).toBe(1);

      const [site] = callSites;
      expect(site.file).toBe("league-pulse.ts");

      // The one call site's line number, mapped back onto league-pulse.ts,
      // must fall within captureLeagueRawData's own body.
      const captureStartLine = source.slice(0, source.indexOf(captureBody)).split(/\r?\n/).length;
      const captureLineCount = captureBody.split(/\r?\n/).length;
      const captureEndLine = captureStartLine + captureLineCount - 1;

      expect(site.line).toBeGreaterThanOrEqual(captureStartLine);
      expect(site.line).toBeLessThanOrEqual(captureEndLine);
    },
  );
});
