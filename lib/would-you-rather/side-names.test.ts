import { describe, expect, it } from "vitest";
import { withTeamNames } from "./side-names";

describe("withTeamNames", () => {
  it("renames the verdict sentence", () => {
    expect(withTeamNames("Side A wins by 11.3% of total trade value.")).toBe(
      "Team A wins by 11.3% of total trade value.",
    );
  });

  it("renames every occurrence in a multi-sentence read", () => {
    const input =
      "Side B wins by 13.2% of total trade value. Side B receives the strongest individual asset in the deal. Side B carries the more concentrated package.";
    expect(withTeamNames(input)).toBe(
      "Team B wins by 13.2% of total trade value. Team B receives the strongest individual asset in the deal. Team B carries the more concentrated package.",
    );
  });

  it("leaves a sentence that already says Team alone", () => {
    expect(withTeamNames("Team A comes out ahead.")).toBe("Team A comes out ahead.");
  });

  it("does not touch a word that merely starts with Side", () => {
    expect(withTeamNames("Sideline A is not a side.")).toBe("Sideline A is not a side.");
    expect(withTeamNames("Inside Access")).toBe("Inside Access");
  });

  it("does not touch a side letter that is not A or B", () => {
    // Signal Check only ever has two sides, so this is defensive: a template
    // naming something else must pass through rather than be half-renamed.
    expect(withTeamNames("Side C is not a thing.")).toBe("Side C is not a thing.");
  });

  it("leaves a neutral verdict with no side in it", () => {
    const neutral = "Too close to call.";
    expect(withTeamNames(neutral)).toBe(neutral);
  });
});
