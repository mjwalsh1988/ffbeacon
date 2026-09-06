/**
 * The saved-handle guard.
 *
 * Same shape and same purpose as `lib/projections/source-guard.test.ts`: it
 * stops a second copy of a read that has to have exactly one.
 *
 * Before `lib/sleeper-handle/resolve.ts` existed, seven files each carried the
 * same three lines to get at `sleeper_league_settings.username`. That is not a
 * tidiness complaint. It is how a real defect stayed invisible: the league deep
 * views match a reader to a roster by `league_users.display_name`, League Pulse
 * forwards `user.display_name` into `?username=`, and a SAVED handle is a
 * USERNAME. Sleeper lets those two strings differ. With seven separate reads
 * there was no single place where anyone would notice that falling back to the
 * saved handle would silently highlight nobody's team.
 *
 * So: `parseSleeperLeagueSettings` is for the LEAGUE keys of that jsonb
 * (`featured_league_id`, `shown_league_ids`, `signal_league_ids`). The IDENTITY
 * keys (`username` and the four migration 0268 added beside it) are read only
 * through `lib/sleeper-handle/resolve.ts` and written only by
 * `app/actions/sleeper-handle.ts`.
 *
 * IF THIS TEST JUST FAILED ON YOUR CHANGE:
 *   1. You want "who is this reader" -> `loadSavedSleeperHandle(supabase)`.
 *   2. You want "who is this surface acting for", with `?username=` in play ->
 *      `resolveSleeperViewer(supabase, params.username)`.
 *   3. You want to render a form or an identity card ->
 *      `resolveHandleGate(supabase, params.username)`.
 *   4. You want to WRITE a handle -> `saveSleeperHandle` from
 *      `app/actions/sleeper-handle.ts`, which resolves it on Sleeper first.
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

/** Top-level files that sit under none of the roots above. */
const SEARCH_FILES = ["middleware.ts"];

/** The call this guard is about. */
const PARSE_CALL = "parseSleeperLeagueSettings(";

/**
 * The identity keys. A file may parse the jsonb for its league keys; reading
 * one of these out of the result is what the guard is here to stop.
 */
const IDENTITY_KEYS = [
  "username",
  "sleeper_user_id",
  "sleeper_display_name",
  "sleeper_avatar",
  "handle_verified_at",
];

/**
 * Files that legitimately parse the jsonb, with the reason each one does.
 *
 * Every entry below reads the LEAGUE keys only. None of them may read an
 * identity key; the second test in this file is what enforces that, so an
 * allow-list entry cannot quietly become a licence to read a username.
 */
const ALLOWLIST: Record<string, string> = {
  "lib/sleeper-league-settings.ts":
    "Declares the parser. There is no call here to attribute anything to.",

  "lib/sleeper-handle/resolve.ts":
    "The one reader of the identity keys. This guard exists to keep it the only one.",

  "app/actions/sleeper-handle.ts":
    "The one writer of the identity keys. Read-merge-write so the league keys survive.",

  "app/my-beacon/actions.ts":
    "Writes featured_league_id and shown_league_ids. Never touches the identity.",

  "app/my-beacon/layout.tsx":
    "Reads shown_league_ids and featured_league_id for the profile league union. Its username read moved to loadSavedSleeperHandle.",

  "app/my-beacon/sleeper-leagues/page.tsx":
    "Reads featured_league_id and shown_league_ids for the league table's star and eye controls. Its identity comes from loadSavedSleeperHandle.",

  "app/my-beacon/signal/actions.ts":
    "Reads and writes signal_league_ids, the ordered public-profile league list.",

  "app/my-beacon/signal/layout/page.tsx":
    "Reads signal_league_ids to narrow the league-block picker to the featured ids.",

  "app/my-beacon/signal/showcase/page.tsx":
    "Reads signal_league_ids for the featured-league manager's initial selection.",

  "lib/signal/editor-data.ts": "Reads signal_league_ids for the Signal editor.",

  "lib/signal-profile.ts":
    "Reads signal_league_ids and featured_league_id for the public /u/[handle] page.",
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

function sourceFiles(): { rel: string; content: string }[] {
  const out: { rel: string; content: string }[] = [];
  for (const rel of SEARCH_FILES) {
    try {
      out.push({ rel, content: readFileSync(path.join(ROOT, rel), "utf8") });
    } catch {
      // A file that is not there cannot read anything.
    }
  }
  for (const root of SEARCH_ROOTS) {
    for (const rel of walk(root)) {
      // A test file naming the call in its own prose is not a second reader.
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
      out.push({
        rel: posix(rel),
        content: readFileSync(path.join(ROOT, rel), "utf8"),
      });
    }
  }
  return out;
}

/**
 * The variable names a file binds the parse result to, as regex fragments.
 *
 * `const settings = parseSleeperLeagueSettings(...)` binds one. A call used
 * inline (`parseSleeperLeagueSettings(x).signal_league_ids`) binds none, so
 * the call expression itself stands in for the name.
 */
export function parsedVariableNames(content: string): string[] {
  const names = new Set<string>();
  const bound =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:\r?\n\s*)?parseSleeperLeagueSettings\(/g;
  let match: RegExpExecArray | null;
  while ((match = bound.exec(content)) !== null) {
    names.add(`\\b${match[1]}`);
    // An alias of the bound name is the same object, so `const s = parse(x);
    // const u = s;` would otherwise hide `u.username` from the check.
    const alias = new RegExp(
      `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${match[1]}\\s*;`,
      "g",
    );
    let aliased: RegExpExecArray | null;
    while ((aliased = alias.exec(content)) !== null) {
      names.add(`\\b${aliased[1]}`);
    }
  }
  // Destructuring reads an identity key with no object to qualify it, so the
  // dotted check would never see it. Two shapes both count: straight off the
  // call, and off a variable already bound to it.
  const boundNames = [...names].map((n) => n.replace("\\b", ""));
  const destructureSources = [
    "parseSleeperLeagueSettings\\(",
    ...boundNames.map((n) => `${n}\\s*;`),
  ];
  for (const source of destructureSources) {
    const destructured = new RegExp(
      `(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*(?:\\r?\\n\\s*)?${source}`,
      "g",
    );
    let picked: RegExpExecArray | null;
    while ((picked = destructured.exec(content)) !== null) {
      if (IDENTITY_KEYS.some((key) => picked![1].includes(key))) {
        names.add("\\{[^}]*\\b");
      }
    }
  }
  if (/parseSleeperLeagueSettings\([^;\n]*\)\s*\./.test(content)) {
    names.add("parseSleeperLeagueSettings\\([^)]*\\)");
  }
  return [...names];
}

/** The column itself. Reaching for it directly is the other way past the parser. */
const COLUMN = "sleeper_league_settings";

/** Block and line comments removed, so prose about the column does not count. */
export function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("saved Sleeper handle guard", () => {
  it("has no file reading the column without the parser", () => {
    const violations: string[] = [];
    for (const { rel, content } of sourceFiles()) {
      if (rel in ALLOWLIST) continue;
      // Generated, and it declares every column on every table.
      if (rel === "lib/database.types.ts") continue;
      if (!content.includes(COLUMN)) continue;
      // A file may NAME the column in prose, and several usefully do: a
      // comment saying where the handle lives is worth having. Only CODE
      // counts, so comments come out before the test.
      if (!stripComments(content).includes(COLUMN)) continue;
      violations.push(rel);
    }
    expect(
      violations,
      `These files name ${COLUMN} directly. Selecting the column and reading the jsonb by hand goes past both the parser and the first assertion in this file, and it is exactly the shape the tool pages used before lib/sleeper-handle/resolve.ts existed, minus one function call. Go through the resolver.\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });

  it("has no writer of an identity key outside the one action", () => {
    const violations: string[] = [];
    for (const { rel, content } of sourceFiles()) {
      // The action that owns the write, and the resolver's own lazy backfill.
      if (rel === "app/actions/sleeper-handle.ts") continue;
      if (rel === "lib/sleeper-handle/resolve.ts") continue;
      if (rel === "lib/sleeper-league-settings.ts") continue;
      if (!content.includes("mergeSleeperLeagueSettings(")) continue;
      for (const key of IDENTITY_KEYS) {
        // A quoted key is the same write. `{ "username": x }` is valid object
        // literal syntax and would otherwise walk past this.
        if (new RegExp(`["']?\\b${key}\\b["']?\\s*:`).test(content)) {
          violations.push(`${rel} (writes ${key})`);
          break;
        }
      }
    }
    expect(
      violations,
      `A saved handle is written ONLY by app/actions/sleeper-handle.ts saveSleeperHandle, which resolves it on Sleeper first and refuses one Sleeper cannot find. A handle that does not exist is a handle every tool then fails on, silently, on every future visit. These files write an identity key directly.\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });

  it("has exactly one module reading the identity keys", () => {
    const violations: string[] = [];
    for (const { rel, content } of sourceFiles()) {
      if (!content.includes(PARSE_CALL)) continue;
      if (rel in ALLOWLIST) continue;
      violations.push(rel);
    }
    expect(
      violations,
      `These files call parseSleeperLeagueSettings without an allow-list entry. Read the reader's Sleeper identity through lib/sleeper-handle/resolve.ts instead. See this file's header for which function you want.\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps every allow-listed file off the identity keys", () => {
    const violations: string[] = [];
    for (const { rel, content } of sourceFiles()) {
      if (!(rel in ALLOWLIST)) continue;
      // The two modules that own the identity are the exception by definition.
      if (rel === "lib/sleeper-handle/resolve.ts") continue;
      if (rel === "app/actions/sleeper-handle.ts") continue;
      if (rel === "lib/sleeper-league-settings.ts") continue;

      // Only what came OUT of the parse call counts. `sleeper_user_id` is
      // also a real column on `league_users`, so a guard that flagged every
      // occurrence of the word would be flagging a different table.
      const names = parsedVariableNames(content);
      if (names.length === 0) continue;

      // Whitespace-normalized and matched over the WHOLE file, not line by
      // line, because `settings\n  .username` is the same read as
      // `settings.username` and a per-line regex sees neither half of it.
      const flat = stripComments(content).replace(/\s+/g, " ");
      for (const name of names) {
        for (const key of IDENTITY_KEYS) {
          // `x.username`, `x?.username`, and `x["username"]`. Optional
          // chaining is not an exotic idiom to guard against: resolve.ts
          // itself uses it, so it is the FIRST thing a copy of that code
          // would carry.
          const patterns = [
            `${name}\\s*\\??\\.\\s*${key}\\b`,
            `${name}\\s*\\?\\?\\.\\s*\\[\\s*["'\`]${key}["'\`]\\s*\\]`,
            `${name}\\s*\\[\\s*["'\`]${key}["'\`]\\s*\\]`,
          ];
          if (patterns.some((p) => new RegExp(p).test(flat))) {
            violations.push(`${rel} (reads ${key})`);
          }
        }
      }
    }
    expect(
      violations,
      `An allow-listed file is reading an identity key. Those entries exist for the LEAGUE keys only; the identity comes from lib/sleeper-handle/resolve.ts.\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });

  it("has no stale allow-list entries", () => {
    const files = new Set(sourceFiles().map((f) => f.rel));
    const stale = Object.keys(ALLOWLIST).filter((rel) => !files.has(rel));
    expect(
      stale,
      `These allow-list entries name files that no longer exist. Delete them.\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });
});
