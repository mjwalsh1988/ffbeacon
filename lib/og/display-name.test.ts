import { describe, expect, it } from "vitest";
import { DEFENDER_LINE_BUDGET, DEFENDER_LINE_PREFIX, defenderFooterLine } from "./display-name";

describe("defenderFooterLine (review item 54)", () => {
  it("prints nothing for a team with no defenders", () => {
    expect(defenderFooterLine([])).toBe("");
  });

  it("prints a short list whole", () => {
    expect(defenderFooterLine(["Roquan Smith", "Fred Warner"])).toBe(
      `${DEFENDER_LINE_PREFIX}Roquan Smith, Fred Warner`,
    );
  });

  it("never exceeds the budget, and counts every name it does not print", () => {
    const names = [
      "Christian Wilkins-Longername",
      "Jeremiah Owusu-Koramoah",
      "Maxx Crosby",
      "Kwity Paye",
      "Jaelan Phillips",
      "Chauncey Gardner-Johnson",
      "Tremaine Edmunds",
      "Sauce Gardner",
      "Derwin James",
      "Budda Baker",
      "Minkah Fitzpatrick",
      "Talanoa Hufanga",
    ];
    const line = defenderFooterLine(names);
    expect(line.length).toBeLessThanOrEqual(DEFENDER_LINE_BUDGET);
    const match = line.match(/ and (\d+) more$/);
    expect(match).not.toBeNull();
    const printed = line.slice(DEFENDER_LINE_PREFIX.length, match!.index).split(", ").length;
    expect(printed + Number(match![1])).toBe(names.length);
  });

  it("always prints at least one name, shortened", () => {
    const line = defenderFooterLine(["Christian Wilkins-Longername", "A B"], 30);
    expect(line).toBe(`${DEFENDER_LINE_PREFIX}Wilkins-Longername and 1 more`);
  });
});
