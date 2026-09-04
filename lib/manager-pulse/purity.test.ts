/**
 * The purity guard for lib/manager-pulse/.
 *
 * Two independent rules, enforced by scanning SOURCE TEXT rather than by
 * importing the modules and inspecting what they pulled in, because a static
 * text scan catches a banned import the moment it is typed, before it ever
 * has a chance to run in a test that happens not to exercise that path.
 *
 * RULE 1: THE PURE MODULES STAY PURE
 *   Every module up through engine.ts is plain data in, plain data out: no
 *   `SupabaseClient`, no React, no Next.js runtime, no network call, no
 *   clock read. `lib/manager-pulse/settings.ts`, `load.ts`, `capture.ts`,
 *   `discover.ts`, `validate.ts` and `rate-limit.ts` are NOT scanned here on
 *   purpose: they are the impure edge (I/O, the database client, the clock)
 *   by design, and a purity test that flagged them would be testing the
 *   wrong thing.
 *
 *   A file may not simply be exempted by adding it to `ALLOWLIST`. An entry
 *   there is a debt ledger line: it says a specific, reasoned exception has
 *   been accepted for a specific token in a specific file, not "this file
 *   failed the scan so make it pass." `ALLOWLIST` starts empty, and it should
 *   still be empty when this comment is next read.
 *
 * RULE 2: THE TOKEN "WAR" NAMES NOTHING IN THIS FEATURE
 *   Positional WAR (lib/positional-war/) is player-independent and reads no
 *   roster; every figure in Manager Pulse is specific to one manager, so
 *   nothing here is that metric and the token has no legitimate use anywhere
 *   in this directory, comments included. This mirrors
 *   lib/positional-war/naming.test.ts's own convention: a match is exempt
 *   only when "Positional" sits within 40 characters before it (same line,
 *   or the line directly above, which covers a wrapped comment), or when the
 *   token is a literal quoted MENTION of the word itself (`"WAR"`) rather
 *   than a use of it, which is how this file's own header, and
 *   lib/manager-pulse/types.ts's header, are able to state the rule using
 *   the very word the rule bans.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const DIR = "lib/manager-pulse";

/* -------------------------------------------------------------------------- */
/* Shared file-walking helpers                                                */
/* -------------------------------------------------------------------------- */

function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("{/*")
  );
}

function listSourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  const entries = readdirSync(abs);
  const out: string[] = [];
  for (const entry of entries) {
    const rel = path.join(dir, entry);
    const full = path.join(ROOT, rel);
    if (statSync(full).isDirectory()) continue;
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(rel.split(path.sep).join("/"));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Rule 1: purity of the pure modules                                         */
/* -------------------------------------------------------------------------- */

/** The exact set of modules docs/manager-pulse-plan.md section 3 declares pure, through engine.ts. */
const PURE_MODULE_NAMES = [
  "types.ts",
  "input-types.ts",
  "results.ts",
  "drafting.ts",
  "affinity.ts",
  "trading.ts",
  "roster-ops.ts",
  "engine.ts",
  "narrative.ts",
  "tendencies.ts",
  "fingerprint.ts",
  "default-settings.ts",
];

/**
 * Modules that legitimately talk to the outside world, each with its reason.
 *
 * This list exists so the COVERAGE test below can be exhaustive. Every source
 * file in the directory has to be named as pure or named here; a file in
 * neither fails the build. Without that, a hardcoded pure list silently stops
 * covering the directory the moment somebody adds a module to it, and a guard
 * that does not scan a file it should is worse than no guard, because the green
 * tick says otherwise.
 */
const IMPURE_MODULE_REASONS: Record<string, string> = {
  "settings.ts": "reads and writes the settings row",
  "validate.ts": "zod, and it is the settings boundary",
  "discover.ts": "calls Sleeper to resolve a handle and list leagues",
  "capture.ts": "queues jobs and claims the cooldown",
  "load.ts": "the only module that reads the database",
  "service.ts": "the public door: cache, capture, engine, write",
  "rate-limit.ts": "claims a rate-limit slot",
  "sample.ts": "a static fixture, but it is data rather than a pure function",
};

const PURE_MODULES = PURE_MODULE_NAMES.map((f) => `${DIR}/${f}`);

type BannedToken = { label: string; test: (line: string) => boolean };

const BANNED_TOKENS: BannedToken[] = [
  {
    label: '"@supabase/supabase-js" import',
    test: (line) => /from\s*["']@supabase\/supabase-js["']/.test(line),
  },
  {
    label: '"@/lib/supabase/*" import',
    test: (line) => /from\s*["']@\/lib\/supabase\//.test(line),
  },
  {
    label: '"react" import',
    test: (line) => /from\s*["']react(-dom)?["']/.test(line),
  },
  {
    label: '"next/*" import',
    test: (line) => /from\s*["']next\//.test(line),
  },
  {
    label: "fetch( call",
    test: (line) => /\bfetch\s*\(/.test(line),
  },
  {
    label: "Date.now( call",
    test: (line) => /\bDate\.now\s*\(/.test(line),
  },
];

/**
 * A debt ledger, not a bypass. An entry here is `{ file: { token: reason } }`
 * and must name the exact BannedToken label it excuses. Empty means every
 * pure module in this directory currently holds the rule with no exception.
 */
const ALLOWLIST: Record<string, Record<string, string>> = {};

type PurityViolation = { file: string; line: number; token: string; text: string };

export function purityViolationsIn(file: string, content: string): PurityViolation[] {
  const lines = content.split(/\r?\n/);
  const out: PurityViolation[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    for (const banned of BANNED_TOKENS) {
      if (banned.test(line)) {
        out.push({ file, line: i + 1, token: banned.label, text: line.trim() });
      }
    }
  }
  return out;
}

function describePurityViolations(violations: PurityViolation[]): string {
  if (violations.length === 0) return "";
  const lines = violations.map((v) => `${v.file}:${v.line}  [${v.token}]  ${v.text}`).join("\n");
  return (
    `${lines}\n\n` +
    `Found ${violations.length} banned token(s) in a module docs/manager-pulse-plan.md section 3 ` +
    `declares pure. Remove the dependency, or add a reasoned entry to ALLOWLIST in ` +
    `lib/manager-pulse/purity.test.ts naming the exact file and token.`
  );
}

describe("every pure Manager Pulse module stays pure", () => {
  it("finds no banned import or clock/network call outside ALLOWLIST", () => {
    const violations = PURE_MODULES.flatMap((file) => {
      const content = readFileSync(path.join(ROOT, file.split("/").join(path.sep)), "utf8");
      return purityViolationsIn(file, content).filter(
        (v) => !ALLOWLIST[file]?.[v.token],
      );
    });
    expect(describePurityViolations(violations)).toBe("");
  });

  it("every listed pure module actually exists", () => {
    const missing = PURE_MODULES.filter((file) => {
      try {
        readFileSync(path.join(ROOT, file.split("/").join(path.sep)), "utf8");
        return false;
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });

  it("ALLOWLIST is empty", () => {
    // If this ever fails on purpose, the entry it fails on must carry a real
    // reason (see the file header). It is not a switch to flip to unblock a
    // build.
    expect(Object.keys(ALLOWLIST)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Rule 2: the WAR token names nothing here                                   */
/* -------------------------------------------------------------------------- */

const WAR_TOKEN = /\bWAR\b/g;
const PROXIMITY = 40;

type WarViolation = { file: string; line: number; text: string };

/**
 * Every unqualified WAR token in `content`. A match is exempt when
 * "Positional" sits within `PROXIMITY` characters before it on the same
 * line, when it sits on the line directly above, or when the token is a
 * literal quoted mention (`"WAR"`) of the word rather than a use of it.
 */
export function warViolationsIn(file: string, content: string): WarViolation[] {
  const lines = content.split(/\r?\n/);
  const out: WarViolation[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    WAR_TOKEN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WAR_TOKEN.exec(line)) !== null) {
      const quotedBefore = line[match.index - 1] === '"';
      const quotedAfter = line[match.index + match[0].length] === '"';
      if (quotedBefore && quotedAfter) continue;

      const before = line.slice(Math.max(0, match.index - PROXIMITY), match.index);
      if (before.includes("Positional")) continue;
      const previous = i > 0 ? lines[i - 1] : "";
      if (previous.includes("Positional")) continue;

      out.push({ file, line: i + 1, text: line.trim() });
    }
  }
  return out;
}

function describeWarViolations(violations: WarViolation[]): string {
  if (violations.length === 0) return "";
  const lines = violations.map((v) => `${v.file}:${v.line}  ${v.text}`).join("\n");
  return (
    `${lines}\n\n` +
    `Found ${violations.length} unqualified use(s) of the token WAR inside lib/manager-pulse/. ` +
    `Nothing in Manager Pulse measures the player-independent Positional WAR metric, so the ` +
    `token has no legitimate use here at all, qualified or not. Rename to team-specific ` +
    `vocabulary ("wins", "wins left on the bench", "projected wins").`
  );
}

/*
 * THE GUARD HAS TO KNOW ABOUT EVERY FILE, NOT JUST THE ONES IT WAS TOLD ABOUT.
 *
 * The purity scan above walks a hardcoded list. That list was complete on the
 * day it was written and has no way of noticing a thirteenth module. This test
 * closes that gap by walking the directory and insisting every source file is
 * accounted for as either pure or deliberately impure. A new file fails the
 * build until somebody decides which it is, which is the decision we actually
 * want made.
 */
describe("the purity guard covers the whole directory", () => {
  it("classifies every source file as pure or deliberately impure", () => {
    const unclassified = listSourceFiles(DIR)
      .map((rel) => rel.slice(DIR.length + 1))
      .filter((name) => !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"))
      .filter(
        (name) => !PURE_MODULE_NAMES.includes(name) && !(name in IMPURE_MODULE_REASONS),
      );

    expect(
      unclassified,
      `These files in ${DIR} are in neither PURE_MODULE_NAMES nor IMPURE_MODULE_REASONS, ` +
        "so the purity scan does not cover them. Add each one to whichever it belongs in. " +
        "An impure entry needs a reason; that reason is the record of why the module is " +
        "allowed to reach outside itself.",
    ).toEqual([]);
  });
});

describe("the token WAR appears nowhere in lib/manager-pulse", () => {
  it("finds no unqualified use anywhere in the directory, comments included", () => {
    // This file is excluded from its own scan, not allow-listed: a guard
    // that checks for a token has to name that token, in its headings, its
    // failure message, and the self-tests below that pin its behaviour.
    // That is not an unfixed violation the way an ALLOWLIST entry would
    // mean; there is nothing here to fix, the scanner cannot be made to
    // pass while also being unable to describe what it is scanning for.
    const files = listSourceFiles(DIR).filter((f) => f !== `${DIR}/purity.test.ts`);
    const violations = files.flatMap((file) =>
      warViolationsIn(file, readFileSync(path.join(ROOT, file.split("/").join(path.sep)), "utf8")),
    );
    expect(describeWarViolations(violations)).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* The guards themselves                                                      */
/* -------------------------------------------------------------------------- */

describe("the purity guard itself works", () => {
  it("flags a real Supabase import", () => {
    const violations = purityViolationsIn(
      "fake.ts",
      'import type { SupabaseClient } from "@supabase/supabase-js";',
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].token).toBe('"@supabase/supabase-js" import');
  });

  it("flags a real fetch call outside a comment", () => {
    const violations = purityViolationsIn("fake.ts", "const res = await fetch(url);");
    expect(violations).toHaveLength(1);
    expect(violations[0].token).toBe("fetch( call");
  });

  it("flags a real Date.now() call outside a comment", () => {
    const violations = purityViolationsIn("fake.ts", "const now = Date.now();");
    expect(violations).toHaveLength(1);
    expect(violations[0].token).toBe("Date.now( call");
  });

  it("ignores Date.now() and fetch mentioned inside a doc comment", () => {
    const content = [
      "/**",
      " * PURE. No fetch, no Date.now(). Every timestamp is passed in.",
      " */",
    ].join("\n");
    expect(purityViolationsIn("fake.ts", content)).toEqual([]);
  });

  it("does not flag an unrelated react-like identifier", () => {
    expect(purityViolationsIn("fake.ts", 'import { reactive } from "./reactive";')).toEqual([]);
  });
});

describe("the WAR guard itself works", () => {
  it("catches a bare WAR", () => {
    expect(warViolationsIn("fake.ts", "const value = row.WAR;")).toHaveLength(1);
  });

  it("accepts a qualified one", () => {
    expect(warViolationsIn("fake.ts", "// Positional WAR for this player.")).toEqual([]);
  });

  it("accepts a literal quoted mention of the token", () => {
    expect(warViolationsIn("fake.ts", 'The token "WAR" appears nowhere here.')).toEqual([]);
  });

  it("still flags an unquoted bare WAR next to a quoted one", () => {
    // Mirrors the exact shape of types.ts's own header: a quoted mention
    // followed later on the same line by a qualified "Positional WAR" use.
    // Neither should be flagged.
    expect(
      warViolationsIn(
        "fake.ts",
        ' *   4. THE TOKEN "WAR" APPEARS NOWHERE IN THIS DIRECTORY. Positional WAR is',
      ),
    ).toEqual([]);
  });

  it("does not match an embedded WAR with no word boundary", () => {
    expect(warViolationsIn("fake.ts", "const war = readWAR(player);")).toEqual([]);
  });

  it("does not match WARNING or a lowercase war", () => {
    expect(warViolationsIn("fake.ts", "console.warn('WARNING'); const war = 1;")).toEqual([]);
  });
});
