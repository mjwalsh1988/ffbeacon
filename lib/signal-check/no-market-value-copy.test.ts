/**
 * IDP-126: an asset no value source prices reads "No market value" in words,
 * everywhere it renders. Never a red "(no value)", never "n/a", never a "0".
 *
 * A source-level assertion in the style of app/api/og/faab/route.test.ts: the
 * five renderers take full BuilderView and trade-history payloads that a unit
 * test would have to fabricate wholesale, and what matters here is the words
 * each one prints on the noValue branch.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const FILES = [
  "components/signal-check-trade-card.tsx",
  "app/tools/trade-calculator/trade-result.tsx",
  "app/games/would-you-rather/verdict-panel.tsx",
  "app/tools/on-the-clock/trade-history.tsx",
  "app/api/og/trade/[transaction_id]/route.tsx",
];

describe("unpriced assets are described in words", () => {
  for (const file of FILES) {
    it(`${file} says No market value and nothing else`, () => {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).toContain("No market value");
      expect(source).not.toContain("(no value)");
      expect(source).not.toMatch(/noValue \? "n\/a"/);
    });
  }
});
