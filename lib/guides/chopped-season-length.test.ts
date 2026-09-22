import { describe, expect, it } from "vitest";

import {
  NFL_LAST_WEEK,
  knownCountFor,
  seasonLengthFor,
} from "./chopped-season-length";

/**
 * These pin the claims the guide's rules lesson makes in words.
 *
 * The lesson says the published team counts are not arbitrary and then names
 * five of them. If any of these fail, a sentence on the page has become wrong
 * and the number beside it disagrees with the platform it cites.
 */
describe("what a team count implies", () => {
  it("leaves one team standing after N minus 1 chops", () => {
    for (let n = 2; n <= 19; n += 1) {
      const out = seasonLengthFor(n);
      expect(out.chopsToOneLeft).toBe(n - 1);
      expect(out.lastChopWeek).toBe(n - 1);
      expect(out.survivorsAtSeasonEnd).toBe(1);
    }
  });

  it("matches Sleeper's recommended 18, which finishes in week 17", () => {
    const out = seasonLengthFor(18);
    expect(out.lastChopWeek).toBe(17);
    expect(out.unusedWeeks).toBe(1);
    expect(out.shape).toBe("finishes-early");
  });

  /**
   * The one that proves the arithmetic is really what platforms are doing.
   * Yahoo advertises a 13-week public season and runs 14 teams, and 14 minus 1
   * is 13. Nobody picked 13 weeks; they picked 14 teams.
   */
  it("explains Yahoo's 13-week public season from its 14 teams", () => {
    const out = seasonLengthFor(14);
    expect(out.lastChopWeek).toBe(13);
    expect(out.unusedWeeks).toBe(5);
  });

  it("finishes exactly on the season's last week at 19 teams", () => {
    const out = seasonLengthFor(19);
    expect(out.lastChopWeek).toBe(NFL_LAST_WEEK);
    expect(out.unusedWeeks).toBe(0);
    expect(out.shape).toBe("finishes-exactly");
  });

  /**
   * ESPN's published example is 20 teams ending with two alive and the final
   * week's higher score taking the title. 20 minus 18 is 2, so their rule is
   * this arithmetic with a decider bolted on.
   */
  it("leaves ESPN's 20-team example with two alive and no way to chop further", () => {
    const out = seasonLengthFor(20);
    expect(out.lastChopWeek).toBeNull();
    expect(out.survivorsAtSeasonEnd).toBe(2);
    expect(out.shape).toBe("needs-a-decider");
  });

  it("cannot reach one winner at Sleeper's maximum of 32", () => {
    const out = seasonLengthFor(32);
    expect(out.survivorsAtSeasonEnd).toBe(14);
    expect(out.shape).toBe("needs-a-decider");
  });

  /** 19 is the largest league that can chop its way to a single winner. */
  it("puts the boundary between 19 and 20", () => {
    expect(seasonLengthFor(19).shape).not.toBe("needs-a-decider");
    expect(seasonLengthFor(20).shape).toBe("needs-a-decider");
  });

  it("clamps a nonsense count rather than returning a negative season", () => {
    expect(seasonLengthFor(0).teams).toBe(2);
    expect(seasonLengthFor(1).chopsToOneLeft).toBe(1);
    expect(seasonLengthFor(12.7).teams).toBe(12);
  });

  it("names a real format at the sizes the guide cites and nothing at 13", () => {
    expect(knownCountFor(18)?.who).toContain("Sleeper");
    expect(knownCountFor(14)?.who).toContain("Yahoo");
    expect(knownCountFor(13)).toBeNull();
  });
});
