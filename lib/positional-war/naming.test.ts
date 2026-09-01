/**
 * The naming guard.
 *
 * There are two metrics in this product that both convert something into wins,
 * and they answer different questions. Positional WAR is player-independent and
 * measures how scarce a position is in a league. Projected wins is
 * team-specific and measures what a move does to one roster. They legitimately
 * disagree, and a reader shown one under the other's name has no way to detect
 * the swap.
 *
 * So the token "WAR" names exactly ONE metric here, and it carries the word
 * "Positional" adjacent to it on first use in any surface.
 *
 * This test is crude, and it is the only thing that will catch the collision
 * re-emerging in six months. A flat ban on the token inside lib/trade-impact/
 * would be wrong, because the Trade Ideas asset note legitimately prints a
 * Positional WAR figure as labelled context. So the enforceable rule is
 * PROXIMITY rather than absence.
 *
 * Three rules, each a section of this file:
 *
 *   1. Inside lib/trade-impact/, lib/faab/ and lib/power-pulse/, every
 *      occurrence of the token WAR must have the literal "Positional" within 40
 *      characters before it on the same line, or on the line immediately above
 *      when the occurrence sits in a comment.
 *   2. No user-facing string anywhere may contain WAR without "Positional"
 *      adjacent on the same terms.
 *   3. The team-specific vocabulary (winsDelta, expectedWins, "projected wins",
 *      "wins added") must not appear inside lib/positional-war/ or
 *      components/league-war/, except in the upgrade panel and its action,
 *      which is the one place both metrics legitimately meet and which is
 *      required to label both.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

/** Word-boundary, case sensitive. WARNING and warn do not match. */
const WAR_TOKEN = /\bWAR\b/g;

/** How close "Positional" has to sit before the token. */
const PROXIMITY = 40;

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

type Violation = { file: string; line: number; text: string };

/**
 * Whether a line is entirely a comment. Used to scope the user-facing rule,
 * which is about strings a reader sees, not about how the code explains itself.
 *
 * A JSDoc continuation line starts with an asterisk, which is why that is here.
 * `{/*` is here because a JSX comment is still a comment, and the first thing
 * this guard caught without it was a task id, `T-WAR-48`, sitting inside one:
 * the hyphens put word boundaries either side of the token, so a perfectly
 * ordinary reference to the plan read as an unqualified metric name.
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("{/*")
  );
}

/**
 * Every WAR token in `file` that does not have "Positional" within PROXIMITY
 * characters before it on its own line, or anywhere on the line above.
 *
 * The line-above allowance exists because a wrapped comment block routinely
 * splits "Positional" from "WAR" across a line break, and rewrapping a comment
 * should not be able to fail a naming test.
 */
function unqualifiedWarTokens(file: string, opts: { commentsToo: boolean }): Violation[] {
  const lines = readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/);
  const out: Violation[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!opts.commentsToo && isCommentLine(line)) continue;
    WAR_TOKEN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WAR_TOKEN.exec(line)) !== null) {
      const before = line.slice(Math.max(0, match.index - PROXIMITY), match.index);
      if (before.includes("Positional")) continue;
      const previous = i > 0 ? lines[i - 1] : "";
      if (previous.includes("Positional")) continue;
      out.push({ file, line: i + 1, text: line.trim() });
    }
  }
  return out;
}

function describeViolations(violations: Violation[]): string {
  return violations.map((v) => `${v.file}:${v.line}  ${v.text}`).join("\n");
}

describe("the token WAR is always adjacent to Positional", () => {
  // The modules that own the OTHER metric. A bare WAR here is the exact
  // collision the rule exists to prevent.
  //
  // lib/trade-finder joined the list when it started reporting a projected-wins
  // delta of its own (lib/trade-finder/pulse.ts). It computes a team-specific
  // number from a team-specific schedule, which is precisely the class of module
  // that must never borrow the token.
  const GUARDED_DIRECTORIES = [
    "lib/trade-impact",
    "lib/faab",
    "lib/power-pulse",
    "lib/trade-finder",
  ];

  // Comments count here. These modules own the OTHER metric, so a bare WAR in a
  // comment is a reader of this code being told the wrong thing, which is how
  // the collision would come back.
  for (const dir of GUARDED_DIRECTORIES) {
    it(`holds in ${dir}, comments included`, () => {
      const violations = walk(dir).flatMap((f) => unqualifiedWarTokens(f, { commentsToo: true }));
      expect(describeViolations(violations)).toBe("");
    });
  }

  // Rule 2 is about strings a READER sees, so comment lines are out of scope.
  // A component under components/league-war/ is entitled to explain itself in
  // its own header without repeating "Positional" on every line; what it may
  // not do is print a bare WAR to the screen.
  it("holds in every user-facing string in components and routes", () => {
    const violations = [...walk("components"), ...walk("app")].flatMap((f) =>
      unqualifiedWarTokens(f, { commentsToo: false }),
    );
    expect(describeViolations(violations)).toBe("");
  });
});

describe("the team-specific vocabulary stays out of the Positional WAR modules", () => {
  /**
   * The one place both metrics legitimately appear together. It is required to
   * label both, and the sentence it prints is the best argument the product can
   * make that the two numbers are different, so it is allowed the vocabulary it
   * needs to make that argument.
   */
  const UPGRADE_PANEL_ALLOWLIST = [
    "components/league-war/upgrade-panel.tsx",
    "lib/positional-war/upgrade.ts",
    "lib/positional-war/upgrade.test.ts",
  ].map((p) => p.split("/").join(path.sep));

  const TEAM_SPECIFIC = ["winsDelta", "expectedWins", "projected wins", "wins added"];

  // Comment lines are out of scope. These modules are required by the plan to
  // explain how Positional WAR differs from projected wins, and naming the
  // other metric is how that explanation works. What the rule stops is this
  // code COMPUTING or PRINTING the team-specific figure under its own name.
  it("finds none of it in code outside the upgrade panel", () => {
    const files = [...walk("lib/positional-war"), ...walk("components/league-war")].filter(
      (f) => !UPGRADE_PANEL_ALLOWLIST.includes(f) && !f.endsWith("naming.test.ts"),
    );
    const violations: Violation[] = [];
    for (const file of files) {
      const lines = readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (isCommentLine(line)) return;
        for (const token of TEAM_SPECIFIC) {
          if (line.includes(token)) {
            violations.push({ file, line: i + 1, text: line.trim() });
          }
        }
      });
    }
    expect(describeViolations(violations)).toBe("");
  });
});

describe("the guard itself works", () => {
  // A guard that cannot fail is not a guard. These pin the matcher's behaviour
  // against the cases most likely to be got wrong.
  function scan(content: string): number {
    const lines = content.split("\n");
    let count = 0;
    for (let i = 0; i < lines.length; i += 1) {
      WAR_TOKEN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = WAR_TOKEN.exec(lines[i])) !== null) {
        const before = lines[i].slice(Math.max(0, match.index - PROXIMITY), match.index);
        if (before.includes("Positional")) continue;
        if (i > 0 && lines[i - 1].includes("Positional")) continue;
        count += 1;
      }
    }
    return count;
  }

  it("catches a bare WAR", () => {
    expect(scan("const value = row.WAR;")).toBe(1);
  });

  it("does not match an embedded WAR with no word boundary", () => {
    // readWAR has no boundary before the W, so the token rule does not fire.
    // Recorded because it is the guard's one blind spot and it is deliberate:
    // widening it would flag SWAR, WARP, and every other coincidence.
    expect(scan("const war = readWAR(player);")).toBe(0);
  });

  it("accepts a qualified one", () => {
    expect(scan("// Positional WAR for this player.")).toBe(0);
  });

  it("accepts one qualified on the line above", () => {
    expect(scan(" * The Positional\n * WAR figure.")).toBe(0);
  });

  it("rejects one qualified too far away on the same line", () => {
    const far = `// Positional${" ".repeat(60)}WAR`;
    expect(scan(far)).toBe(1);
  });

  it("does not match WARNING, warn, or a lowercase war", () => {
    expect(scan("console.warn('WARNING'); const war = 1;")).toBe(0);
  });
});
