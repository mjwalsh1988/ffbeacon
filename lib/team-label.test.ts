import { describe, it, expect } from "vitest";
import {
  formatTeamLabel,
  formatTeamLabelCompact,
  formatTeamLabelOrNull,
  ownerLine,
  teamLabelParts,
} from "@/lib/team-label";

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

describe("teamLabelParts", () => {
  it("splits the pairing for a stacked layout", () => {
    expect(
      teamLabelParts({
        teamName: "Herbert The Pervert",
        username: "BigBCardz",
        sleeperRosterId: 1,
      }),
    ).toEqual({ primary: "Herbert The Pervert", owner: "@BigBCardz" });
  });

  it("returns no owner line when it would repeat the name", () => {
    expect(
      teamLabelParts({ teamName: null, username: "BenMacleod27", sleeperRosterId: 9 }),
    ).toEqual({ primary: "@BenMacleod27", owner: null });
  });
});

describe("ownerLine", () => {
  it("prefixes the handle", () => {
    expect(ownerLine("Brown Syndrome", "blake3684")).toBe("@blake3684");
  });

  /**
   * The case that put "BenMacleod27" directly above "@BenMacleod27" on the
   * Power Pulse table, the transaction feed, and every matchup header: a
   * manager with no team name falls back to their own handle for the name.
   */
  it("says nothing when the handle is already the name", () => {
    expect(ownerLine("BenMacleod27", "BenMacleod27")).toBeNull();
    expect(ownerLine("benmacleod27", "BenMacleod27")).toBeNull();
  });

  it("says nothing when there is no handle", () => {
    expect(ownerLine("Brown Syndrome", null)).toBeNull();
    expect(ownerLine("Brown Syndrome", "  ")).toBeNull();
  });
});

describe("formatTeamLabelCompact", () => {
  it("trims the team name and keeps the handle whole", () => {
    expect(
      formatTeamLabelCompact(
        {
          teamName: "NowYouCeeDee,NowYouDont",
          username: "Buthunter",
          sleeperRosterId: 3,
        },
        16,
      ),
    ).toBe("NowYouCeeDee,... (@Buthunter)");
  });

  it("leaves a short pairing alone", () => {
    expect(
      formatTeamLabelCompact({
        teamName: "Back 2 back",
        username: "Jackb2007",
        sleeperRosterId: 4,
      }),
    ).toBe("Back 2 back (@Jackb2007)");
  });
});

describe("formatTeamLabelOrNull", () => {
  it("returns null when we know nothing about the manager", () => {
    expect(formatTeamLabelOrNull({ teamName: null, username: null })).toBeNull();
  });

  it("pairs them when we do", () => {
    expect(
      formatTeamLabelOrNull({ teamName: "O-Bijan Kenobi", username: "KingSlinky99" }),
    ).toBe("O-Bijan Kenobi (@KingSlinky99)");
  });
});
