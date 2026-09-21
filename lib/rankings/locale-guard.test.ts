/**
 * Every number on a rankings surface is formatted in one fixed locale.
 *
 * `(1234).toLocaleString()` with no locale uses whatever the machine running
 * it is set to. On the server that is the host's locale; in the browser it is
 * the reader's. The rankings table is a client component, so the same value
 * gets formatted twice, and on a de-DE browser the server writes "9,980" and
 * the client writes "9.980". React notices, warns about a hydration mismatch,
 * and patches the DOM. Nothing visibly breaks, which is exactly why it sat
 * there unnoticed on the Value column since the board shipped.
 *
 * The rule is the one lib/beam/answers/format.ts already follows: pass
 * "en-US" explicitly. Same reasoning as the timezone rule in CLAUDE.md, where
 * a bare toLocale* call picks up the viewer's zone on the client and the
 * server's on the server, and both are wrong.
 *
 * A crude string scan is the only thing that will catch this drifting back,
 * once nobody remembers the rule was written down. Modeled on
 * lib/projections/raw-column-guard.test.ts.
 *
 * IF THIS TEST JUST FAILED ON YOUR CHANGE: add the locale.
 * `value.toLocaleString("en-US")`. That is the whole fix. Do not add a file
 * to SCANNED below to make it pass; add it when you write a new rankings
 * surface, so the new surface is covered too.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

/** Every file that renders a number onto a rankings surface. */
const SCANNED = [
  "components/rankings-table.tsx",
  "components/rankings/rankings-view.tsx",
  "components/rankings/board-pulse-panel.tsx",
  "components/rankings/market-movers.tsx",
  "lib/rankings/faq.ts",
  "lib/rankings/insights.ts",
  "lib/rankings/tiers.ts",
];

/**
 * A `toLocale*` call whose first argument is not a string literal. Catches
 * `toLocaleString()`, `toLocaleDateString()` and a call opening on a variable
 * or an options object, while allowing `toLocaleString("en-US", {...})`.
 */
const BARE_CALL = /\.toLocale(?:String|DateString|TimeString)\(\s*(?!["'])/g;

describe("rankings number formatting", () => {
  it.each(SCANNED)("%s passes an explicit locale to every toLocale call", (file) => {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    const offenders: string[] = [];
    const lines = source.split("\n");
    lines.forEach((line, i) => {
      BARE_CALL.lastIndex = 0;
      if (BARE_CALL.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("scans files that actually exist, so a rename cannot silently empty it", () => {
    for (const file of SCANNED) {
      expect(() => readFileSync(path.join(ROOT, file), "utf8")).not.toThrow();
    }
  });

  it("would catch a bare call if one came back", () => {
    // The regex is the whole guard, so it gets its own assertion rather than
    // being trusted. A guard that silently stops matching is worse than none.
    const bare = 'const x = row.value.toLocaleString();';
    const withLocale = 'const x = row.value.toLocaleString("en-US");';
    const withOptions = 'const x = v.toLocaleString("en-US", { maximumFractionDigits: 1 });';
    BARE_CALL.lastIndex = 0;
    expect(BARE_CALL.test(bare)).toBe(true);
    BARE_CALL.lastIndex = 0;
    expect(BARE_CALL.test(withLocale)).toBe(false);
    BARE_CALL.lastIndex = 0;
    expect(BARE_CALL.test(withOptions)).toBe(false);
  });
});
