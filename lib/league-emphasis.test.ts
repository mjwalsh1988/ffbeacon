import { describe, it, expect } from "vitest";
import { emphasisForCategory, emphasisForDynastyFlag } from "./league-emphasis";

describe("emphasisForCategory", () => {
  it("leads with value where the asset base outlives the season", () => {
    for (const category of ["dynasty", "best-ball-dynasty"] as const) {
      expect(emphasisForCategory(category).mode, category).toBe("value");
      expect(emphasisForCategory(category).winsFirst).toBe(false);
    }
  });

  it("leads with wins where nobody is holding anyone for next year", () => {
    for (const category of ["redraft", "best-ball-redraft"] as const) {
      expect(emphasisForCategory(category).mode, category).toBe("wins");
      expect(emphasisForCategory(category).winsFirst).toBe(true);
    }
  });

  it("leads with wins when the league cannot be placed", () => {
    // Projected wins is meaningful in every format. Asset value is only
    // meaningful in half of them, so it is the wrong default for an unknown.
    expect(emphasisForCategory(null).mode).toBe("wins");
  });

  it("renames the value column rather than removing it", () => {
    const redraft = emphasisForCategory("redraft");
    const dynasty = emphasisForCategory("dynasty");
    expect(redraft.valueLabel).not.toBe(dynasty.valueLabel);
    expect(redraft.valueLabel.length).toBeGreaterThan(0);
    expect(dynasty.valueLabel.length).toBeGreaterThan(0);
  });

  it("explains the value column in both modes, so it is never an unlabelled number", () => {
    for (const category of [
      "dynasty",
      "redraft",
      "best-ball-dynasty",
      "best-ball-redraft",
    ] as const) {
      expect(
        emphasisForCategory(category).valueHint.length,
        category,
      ).toBeGreaterThan(40);
    }
  });
});

describe("emphasisForDynastyFlag", () => {
  it("agrees with the category form", () => {
    expect(emphasisForDynastyFlag(true)).toEqual(
      emphasisForCategory("dynasty"),
    );
    expect(emphasisForDynastyFlag(false)).toEqual(
      emphasisForCategory("redraft"),
    );
  });
});
