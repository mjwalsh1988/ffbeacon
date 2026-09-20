import { describe, expect, it } from "vitest";

import { buildReasons, type ReasonInput } from "./reasons";

function input(over: Partial<ReasonInput> = {}): ReasonInput {
  return {
    interestedRivals: null,
    netPointsPerWeek: null,
    ...over,
  };
}

describe("buildReasons", () => {
  it("says nothing at all when it knows nothing", () => {
    expect(buildReasons(input())).toEqual([]);
  });

  it("never invents a figure it was not given", () => {
    const lines = buildReasons(input({ netPointsPerWeek: 2.4 }));
    expect(lines).toEqual(["Adds 2.4 points a week over your current lineup."]);
  });

  it("caps the list so the card stays readable", () => {
    const lines = buildReasons(
      input({
        interestedRivals: 3,
        netPointsPerWeek: 4,
        playoffOddsBefore: 40,
        playoffOddsAfter: 55,
        heat: 1.4,
        heatSamples: 30,
        richestRivalBudget: 80,
        yourBudget: 60,
        teammateName: "Test Player",
        teammateStatus: "OUT",
        calendarMultiplier: 1.1,
        currentWeek: 4,
      }),
    );
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it("leads with the rivals, which set the price", () => {
    const lines = buildReasons(input({ interestedRivals: 4, netPointsPerWeek: 3 }));
    expect(lines[0]).toBe("4 teams would start him.");
  });
});

describe("rivals", () => {
  it("counts one team as a team", () => {
    expect(buildReasons(input({ interestedRivals: 1 }))[0]).toBe("1 team would start him.");
  });

  it("names how many of them have a hole to fill", () => {
    expect(buildReasons(input({ interestedRivals: 5, rivalsWithStarterOut: 2 }))[0]).toBe(
      "5 teams would start him, 2 of them with a starter out.",
    );
  });

  it("drops the clause when none of them do", () => {
    expect(buildReasons(input({ interestedRivals: 5, rivalsWithStarterOut: 0 }))[0]).toBe(
      "5 teams would start him.",
    );
  });

  it("says so when nobody wants him", () => {
    expect(buildReasons(input({ interestedRivals: 0 }))[0]).toBe("Nobody else would start him.");
  });
});

describe("the upgrade line", () => {
  it("names the player being cut when there is one", () => {
    const lines = buildReasons(input({ netPointsPerWeek: 1.5, dropName: "Test Player" }));
    expect(lines[0]).toBe("Adds 1.5 points a week over Test Player.");
  });

  it("says when playoff weeks are in the figure", () => {
    const lines = buildReasons(input({ netPointsPerWeek: 2, includesPlayoffWeeks: true }));
    expect(lines[0]).toContain("playoffs included");
  });
});

describe("chopped leagues", () => {
  it("talks about being chopped, never about playoffs", () => {
    const lines = buildReasons(
      input({
        choppedBefore: 18,
        choppedAfter: 9,
        playoffOddsBefore: 40,
        playoffOddsAfter: 60,
      }),
    );
    const joined = lines.join(" ");
    expect(joined).toContain("Cuts your chance of being chopped this week from 18% to 9%.");
    expect(joined).not.toContain("Playoff");
  });

  it("reports the money still in the league", () => {
    const lines = buildReasons(
      input({ aliveCount: 12, moneyLeftInLeague: 4200, yourShareOfMoney: 0.24 }),
    );
    expect(lines.join(" ")).toContain("12 teams left, holding 4200 between them; you hold 24%.");
  });
});

describe("league heat", () => {
  it("stays quiet on a thin sample", () => {
    expect(buildReasons(input({ heat: 1.8, heatSamples: 4 }))).toEqual([]);
  });

  it("stays quiet when the league is ordinary", () => {
    expect(buildReasons(input({ heat: 1.05, heatSamples: 50 }))).toEqual([]);
  });

  it("speaks up on a hot room", () => {
    expect(buildReasons(input({ heat: 1.6, heatSamples: 50 }))[0]).toBe(
      "Your league pays 1.6 times the usual price for contested adds.",
    );
  });

  it("speaks up on a cheap room too", () => {
    expect(buildReasons(input({ heat: 0.6, heatSamples: 50 }))[0]).toContain("cheaper than most");
  });
});

describe("money", () => {
  it("names the richest rival when they can outbid you", () => {
    expect(buildReasons(input({ richestRivalBudget: 90, yourBudget: 40 }))[0]).toBe(
      "The richest rival holds 90; you hold 40.",
    );
  });

  it("says when nobody can", () => {
    expect(buildReasons(input({ richestRivalBudget: 20, yourBudget: 80 }))[0]).toContain(
      "nobody left in the league can outbid you",
    );
  });
});

describe("the calendar", () => {
  it("stays quiet in a neutral stretch", () => {
    expect(buildReasons(input({ calendarMultiplier: 1, currentWeek: 12 }))).toEqual([]);
  });

  it("warns that late budget buys nothing", () => {
    expect(buildReasons(input({ calendarMultiplier: 1.3, currentWeek: 15 }))[0]).toBe(
      "From week 14 leftover FAAB buys nothing.",
    );
  });

  it("names the expensive early stretch", () => {
    expect(buildReasons(input({ calendarMultiplier: 1.1, currentWeek: 3 }))[0]).toBe(
      "Weeks 2 to 6 are the busiest bidding of the season.",
    );
  });
});

describe("dynasty", () => {
  it("fires only when the long-term value is actually raising the bid", () => {
    expect(
      buildReasons(input({ dynastyBlendWeight: 0.6, dynastyValuePct: 10, pointsWorthPct: 40 })),
    ).toEqual([]);
    expect(
      buildReasons(input({ dynastyBlendWeight: 0.6, dynastyValuePct: 50, pointsWorthPct: 20 })),
    ).toEqual(["In a dynasty league his long-term value adds to the bid."]);
  });

  it("stays quiet for a contender, where the blend is small", () => {
    expect(
      buildReasons(input({ dynastyBlendWeight: 0.15, dynastyValuePct: 50, pointsWorthPct: 20 })),
    ).toEqual([]);
  });
});

describe("the teammate signal", () => {
  it("names him and his status in lower case", () => {
    expect(buildReasons(input({ teammateName: "Test Player", teammateStatus: "OUT" }))[0]).toBe(
      "His starter, Test Player, is out.",
    );
  });
});

describe("punctuation", () => {
  /**
   * The owner reads by screen reader and every one of these characters is
   * announced. The regex is written with escape sequences on purpose: putting
   * the literal characters in this file would be the very thing it forbids.
   */
  it("emits no dash, curly quote or ellipsis character in any template", () => {
    const banned = /[\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u00B7\u00A0]/;
    const everything = buildReasons(
      {
        interestedRivals: 4,
        rivalsWithStarterOut: 2,
        netPointsPerWeek: 3.2,
        dropName: "Test Player",
        includesPlayoffWeeks: true,
        playoffOddsBefore: 40,
        playoffOddsAfter: 61,
        heat: 1.5,
        heatSamples: 40,
        richestRivalBudget: 90,
        yourBudget: 50,
        calendarMultiplier: 1.3,
        currentWeek: 15,
        teammateName: "Test Player",
        teammateStatus: "DOUBTFUL",
        dynastyBlendWeight: 0.6,
        dynastyValuePct: 50,
        pointsWorthPct: 10,
        aliveCount: 12,
        moneyLeftInLeague: 4200,
        yourShareOfMoney: 0.3,
        choppedBefore: 18,
        choppedAfter: 9,
      },
      99,
    );
    expect(everything.length).toBeGreaterThan(5);
    for (const line of everything) {
      expect(banned.test(line)).toBe(false);
    }
  });
});

describe("a figure that has not moved", () => {
  /**
   * Found by running the engine against a real chopped league: a line that
   * printed "from 2% to 2%" looked like a broken calculator and took the
   * place of a reason that would have told the reader something.
   */
  it("says the chopped odds barely move rather than printing the same number twice", () => {
    const line = buildReasons(input({ choppedBefore: 1.7, choppedAfter: 1.7 }))[0];
    expect(line).toBe(
      "He barely moves your chance of being chopped this week, which sits at 2%.",
    );
  });

  it("says playoff odds stay put rather than printing them twice", () => {
    const line = buildReasons(input({ playoffOddsBefore: 70.2, playoffOddsAfter: 70.4 }))[0];
    expect(line).toBe("Your playoff odds stay at 70% either way.");
  });

  it("still reports a real move", () => {
    expect(buildReasons(input({ choppedBefore: 18, choppedAfter: 9 }))[0]).toBe(
      "Cuts your chance of being chopped this week from 18% to 9%.",
    );
  });
});
