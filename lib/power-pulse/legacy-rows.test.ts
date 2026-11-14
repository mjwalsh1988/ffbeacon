import { describe, expect, it } from "vitest";
import { isLegacyBracketRowForChoppedLeague, modelVersionNumber } from "./legacy-rows";

describe("modelVersionNumber", () => {
  it("reads the number off every version shape the cache has held", () => {
    expect(modelVersionNumber("pp-8:sleeper")).toBe(8);
    expect(modelVersionNumber("pp-11")).toBe(11);
    expect(modelVersionNumber("pp-12+ab1:sleeper:xyz@k9")).toBe(12);
    expect(modelVersionNumber("v1")).toBeNull();
    expect(modelVersionNumber(null)).toBeNull();
  });
});

describe("isLegacyBracketRowForChoppedLeague", () => {
  it("drops a pp-6 to pp-8 bracket row in a chopped-type league", () => {
    for (const v of ["pp-6:sleeper", "pp-7:sleeper", "pp-8:sleeper"]) {
      expect(isLegacyBracketRowForChoppedLeague({ chopped: false, model_version: v }, 3)).toBe(true);
    }
  });

  it("keeps a row the chopped model wrote, and a later non-chopped row", () => {
    expect(isLegacyBracketRowForChoppedLeague({ chopped: true, model_version: "pp-8:sleeper" }, 3)).toBe(false);
    expect(isLegacyBracketRowForChoppedLeague({ chopped: false, model_version: "pp-10" }, 3)).toBe(false);
  });

  it("never touches an ordinary league", () => {
    expect(isLegacyBracketRowForChoppedLeague({ chopped: false, model_version: "pp-6:sleeper" }, 0)).toBe(false);
  });
});
