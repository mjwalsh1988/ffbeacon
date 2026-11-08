import { describe, expect, it } from "vitest";
import { pickRateSeason, rateOf } from "./rates";

describe("pickRateSeason", () => {
  it("skips a season with a tiny denominator for the prior one", () => {
    expect(
      pickRateSeason(
        [
          { season: 2027, redraftTotal: 4 },
          { season: 2026, redraftTotal: 1035 },
        ],
        50,
      ),
    ).toBe(2026);
  });

  it("returns null when none qualifies", () => {
    expect(pickRateSeason([{ season: 2026, redraftTotal: 10 }], 50)).toBeNull();
  });
});

describe("rateOf", () => {
  it("divides and treats a missing denominator as 0", () => {
    expect(rateOf(25, 100)).toBe(0.25);
    expect(rateOf(5, 0)).toBe(0);
    expect(rateOf(null, 100)).toBe(0);
  });
});
