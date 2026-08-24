import { describe, it, expect } from "vitest";
import { formatTeamLabel } from "./league-load";

/**
 * Team names change mid-season and handles do not, so every rival named in this
 * calculator carries both. These pin the four shapes the data actually arrives
 * in: Sleeper's `team_name` is optional and frequently null.
 */
describe("formatTeamLabel", () => {
  it("puts the handle after the team name", () => {
    expect(
      formatTeamLabel({
        teamName: "Herbert The Pervert",
        username: "BigBCardz",
        sleeperRosterId: 1,
      }),
    ).toBe("Herbert The Pervert (@BigBCardz)");
  });

  it("falls back to the handle alone when no team name is set", () => {
    expect(
      formatTeamLabel({ teamName: null, username: "BenMacleod27", sleeperRosterId: 9 }),
    ).toBe("@BenMacleod27");
  });

  it("does not print the same name twice", () => {
    expect(
      formatTeamLabel({ teamName: "BigBCardz", username: "bigbcardz", sleeperRosterId: 1 }),
    ).toBe("@bigbcardz");
  });

  it("treats whitespace as absent", () => {
    expect(
      formatTeamLabel({ teamName: "   ", username: "perrylycett", sleeperRosterId: 8 }),
    ).toBe("@perrylycett");
  });

  it("keeps the team name when the handle is missing", () => {
    expect(
      formatTeamLabel({ teamName: "Brown Syndrome", username: null, sleeperRosterId: 7 }),
    ).toBe("Brown Syndrome");
  });

  it("names the roster when Sleeper gives us neither", () => {
    expect(formatTeamLabel({ sleeperRosterId: 4 })).toBe("Team 4");
  });
});
