import { describe, it, expect } from "vitest";
import { classifyTeamStatus, teamStatusWords } from "./league-team-status";

const twelve = (pulseRank: number | null, valueRank: number | null = null) =>
  classifyTeamStatus({ pulseRank, valueRank, teamCount: 12 });

describe("classifyTeamStatus", () => {
  it("returns null with no Power Pulse rank, which is the unsynced case", () => {
    expect(twelve(null)).toBeNull();
    expect(classifyTeamStatus({ pulseRank: 3, valueRank: 1, teamCount: 1 })).toBeNull();
  });

  it("calls the top of the league competitors regardless of value", () => {
    expect(twelve(1, 12)?.key).toBe("competitor");
    expect(twelve(4, 9)?.key).toBe("competitor");
  });

  it("calls the bottom of the league rebuilders", () => {
    expect(twelve(12, 12)?.key).toBe("rebuilder");
    expect(twelve(9, 9)?.key).toBe("rebuilder");
  });

  it("leaves the middle in the middle when value agrees with Power Pulse", () => {
    expect(twelve(6, 6)?.key).toBe("middle");
    expect(twelve(7, 7)?.key).toBe("middle");
  });

  it("pulls a mid-table team into rebuilder when it holds far more value than it starts", () => {
    // 6th by wins, 1st by assets: the classic rebuild signature.
    expect(twelve(6, 1)?.key).toBe("rebuilder");
    expect(twelve(6, 1)?.reason).toContain("assets are ahead of the wins");
  });

  it("does not let a cheap roster lose its competitor tag", () => {
    // 2nd by Power Pulse, dead last by value. Still winning, still a competitor.
    expect(twelve(2, 12)?.key).toBe("competitor");
  });

  it("classifies on Power Pulse alone when no source covers the league's format", () => {
    expect(twelve(2, null)?.key).toBe("competitor");
    expect(twelve(11, null)?.key).toBe("rebuilder");
    expect(twelve(6, null)?.key).toBe("middle");
  });

  it("scales the bands with league size", () => {
    // 3rd of 8 is a competitor; 3rd of 16 is not yet.
    expect(classifyTeamStatus({ pulseRank: 3, valueRank: 3, teamCount: 8 })?.key).toBe(
      "competitor",
    );
    expect(classifyTeamStatus({ pulseRank: 6, valueRank: 6, teamCount: 8 })?.key).toBe(
      "rebuilder",
    );
    expect(classifyTeamStatus({ pulseRank: 8, valueRank: 8, teamCount: 16 })?.key).toBe(
      "middle",
    );
  });

  it("names the team's actual placing in the reason", () => {
    expect(twelve(1, 1)?.reason).toContain("1st of 12 by Power Pulse");
  });

  it("speaks dynasty by default", () => {
    expect(twelve(1, 1)?.label).toBe("Contender");
    expect(twelve(6, 6)?.label).toBe("Bubble");
    expect(twelve(12, 12)?.label).toBe("Rebuilder");
  });

  it("calls the bottom band a Longshot in a one-year league", () => {
    const redraft = (pulseRank: number, valueRank: number) =>
      classifyTeamStatus({ pulseRank, valueRank, teamCount: 12, variant: "redraft" });
    expect(redraft(12, 12)?.label).toBe("Longshot");
    // Same band, same reasoning, different word.
    expect(redraft(12, 12)?.key).toBe("rebuilder");
    expect(redraft(1, 1)?.label).toBe("Contender");
    expect(redraft(6, 6)?.label).toBe("Bubble");
  });

  it("changes only the words, never the classification", () => {
    for (const rank of [1, 3, 5, 6, 7, 9, 12]) {
      expect(
        classifyTeamStatus({ pulseRank: rank, valueRank: rank, teamCount: 12, variant: "redraft" })
          ?.key,
      ).toBe(twelve(rank, rank)?.key);
    }
  });

  it("carries the variant that produced its words", () => {
    expect(twelve(12, 12)?.variant).toBe("dynasty");
    expect(
      classifyTeamStatus({ pulseRank: 12, valueRank: 12, teamCount: 12, variant: "redraft" })
        ?.variant,
    ).toBe("redraft");
  });
});

describe("teamStatusWords", () => {
  it("gives the middle band a form that survives an indefinite article", () => {
    // "a Bubble" is not a sentence. Every prose surface uses `phrase`.
    expect(teamStatusWords("middle").label).toBe("Bubble");
    expect(teamStatusWords("middle").phrase).toBe("Bubble team");
  });

  it("shortens only what needs shortening", () => {
    expect(teamStatusWords("competitor").short).toBe("Contend");
    expect(teamStatusWords("rebuilder", "redraft").short).toBe("Longshot");
  });
});
