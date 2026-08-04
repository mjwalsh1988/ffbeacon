import { describe, expect, it } from "vitest";
import { describeStandingFigure } from "./team-standing-figure";

const base = {
  projectedSeed: 4,
  rankedTeamCount: 12,
  valueRank: 3,
  totalValue: 4182,
  valueIsExact: true,
  leagueTeamCount: 12,
};

describe("describeStandingFigure", () => {
  it("gives a competitor its projected finish and names the measure", () => {
    expect(
      describeStandingFigure({ ...base, statusKey: "competitor", projectedSeed: 2 }),
    ).toBe("Projected to finish 2nd of 12 by expected wins.");
  });

  it("gives a mid-table team the same finish treatment", () => {
    expect(describeStandingFigure({ ...base, statusKey: "middle" })).toBe(
      "Projected to finish 4th of 12 by expected wins.",
    );
  });

  it("gives a rebuilder its roster value and value rank instead", () => {
    expect(describeStandingFigure({ ...base, statusKey: "rebuilder" })).toBe(
      "Total roster value 4,182, ranked 3rd of 12 by roster value.",
    );
  });

  it("ranks a rebuilder against every roster, not only the ones Power Pulse scored", () => {
    // rankedTeamCount can trail leagueTeamCount when a roster has no Pulse row.
    // A value rank covers the whole league, so it must use the league's count.
    expect(
      describeStandingFigure({
        ...base,
        statusKey: "rebuilder",
        rankedTeamCount: 10,
        leagueTeamCount: 12,
      }),
    ).toBe("Total roster value 4,182, ranked 3rd of 12 by roster value.");
  });

  it("still shows a rebuilder its value on an inexact match, and says the match is approximate", () => {
    // Around a fifth of synced leagues have no format_config_id at all, so they
    // can never match exactly. Withholding the value there handed a Rebuilder a
    // projected finish, which is the one number a rebuild is not measured by.
    expect(
      describeStandingFigure({
        ...base,
        statusKey: "rebuilder",
        valueIsExact: false,
      }),
    ).toBe(
      "Total roster value 4,182, ranked 3rd of 12 by roster value. This league's scoring does not match a format we carry values for, so this is our closest match.",
    );
  });

  it("does not add the approximate caveat when the match was exact", () => {
    expect(
      describeStandingFigure({ ...base, statusKey: "rebuilder" }),
    ).not.toContain("closest match");
  });

  it("never prints a value figure when there is no value to print", () => {
    expect(
      describeStandingFigure({
        ...base,
        statusKey: "rebuilder",
        totalValue: null,
      }),
    ).toBe("Projected to finish 4th of 12 by expected wins.");
  });

  it("says nothing at all rather than guessing when there is no projection", () => {
    expect(
      describeStandingFigure({
        ...base,
        statusKey: "competitor",
        projectedSeed: null,
      }),
    ).toBe("");
  });

  it("drops the denominator rather than inventing one", () => {
    expect(
      describeStandingFigure({
        ...base,
        statusKey: "competitor",
        projectedSeed: 1,
        rankedTeamCount: null,
      }),
    ).toBe("Projected to finish 1st by expected wins.");
  });

  it("uses the ordinal forms that trip up naive suffix logic", () => {
    const seeds = [1, 2, 3, 11, 12, 13, 21, 22, 23];
    const got = seeds.map(
      (projectedSeed) =>
        describeStandingFigure({
          ...base,
          statusKey: "middle",
          projectedSeed,
          rankedTeamCount: null,
        }).split(" ")[3],
    );
    expect(got).toEqual([
      "1st",
      "2nd",
      "3rd",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
    ]);
  });
});
