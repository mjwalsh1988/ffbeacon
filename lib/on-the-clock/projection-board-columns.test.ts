import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A select list is not usually worth a test. This one is, because the column it
 * was missing is invisible at every layer above it.
 *
 * `projectPlayerWeek` reads `projection.availability` to decide whether the
 * SOURCE has already priced an injury designation in. The field is optional on
 * ProjectionRow so a caller building rows by hand keeps the conservative
 * behaviour, which means an unselected column does not fail a type check, does
 * not throw, and does not look wrong in any output. It just quietly makes the
 * draft room answer a different question from the Power Pulse page: our own
 * Questionable discount applied on top of a number Sleeper had already
 * discounted, and a season-long designation overruling a return timeline the
 * Power Pulse page honours.
 *
 * Same idea as lib/positional-war/naming.test.ts: a rule the compiler cannot
 * express, enforced by reading the source.
 */
describe("the projection sweep's select list", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/on-the-clock/projection-board.ts"),
    "utf8",
  );

  it("loads availability, which projectPlayerWeek needs to read the source's opinion", () => {
    const select = source.match(/\.from\("player_weekly_projections"\)\s*\.select\(\s*([\s\S]*?)\)/);
    expect(select, "could not find the projections select in projection-board.ts").not.toBeNull();
    expect(select![1]).toContain("availability");
  });

  it("maps it onto the row rather than selecting it and dropping it", () => {
    expect(source).toContain("availability: row.availability");
  });
});
