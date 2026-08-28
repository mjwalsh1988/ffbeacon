import { describe, expect, it } from "vitest";
import { useTeamNames } from "./side-names";

describe("useTeamNames", () => {
  it("renames the verdict sentence", () => {
    expect(useTeamNames("Side A wins by 11.3% of total trade value.")).toBe(
      "Team A wins by 11.3% of total trade value.",
    );
  });

  it("renames every occurrence in a multi-sentence read", () => {
    const input =
      "Side B wins by 13.2% of total trade value. Side B receives the strongest individual asset in the deal. Side B carries the more concentrated package.";
    expect(useTeamNames(input)).toBe(
      "Team B wins by 13.2% of total trade value. Team B receives the strongest individual asset in the deal. Team B carries the more concentrated package.",
    );
  });

  it("leaves a sentence that already says Team alone", () => {
    expect(useTeamNames("Team A comes out ahead.")).toBe("Team A comes out ahead.");
  });

  it("does not touch a word that merely starts with Side", () => {
    expect(useTeamNames("Sideline A is not a side.")).toBe("Sideline A is not a side.");
    expect(useTeamNames("Inside Access")).toBe("Inside Access");
  });

  it("does not touch a side letter that is not A or B", () => {
    // Signal Check only ever has two sides, so this is defensive: a template
    // naming something else must pass through rather than be half-renamed.
    expect(useTeamNames("Side C is not a thing.")).toBe("Side C is not a thing.");
  });

  it("leaves a neutral verdict with no side in it", () => {
    const neutral = "Too close to call.";
    expect(useTeamNames(neutral)).toBe(neutral);
  });
});
