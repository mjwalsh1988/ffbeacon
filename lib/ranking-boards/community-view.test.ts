import { describe, expect, it } from "vitest";
import {
  communityMovement,
  communityPageState,
  communityRankLine,
  ordinalRank,
  sortCommunityGroups,
  strengthPercent,
} from "./community-view";

describe("communityMovement", () => {
  it("says up when the rank number fell", () => {
    expect(communityMovement(9, 6)).toEqual({ kind: "up", places: 3, words: "up 3" });
  });
  it("says down when the rank number rose", () => {
    expect(communityMovement(4, 6)).toEqual({ kind: "down", places: 2, words: "down 2" });
  });
  it("says same for no change and new for no previous rank", () => {
    expect(communityMovement(5, 5).words).toBe("same");
    expect(communityMovement(null, 5).words).toBe("new");
    expect(communityMovement(undefined, 1).kind).toBe("new");
  });
});

describe("ordinalRank and communityRankLine", () => {
  it("handles the teens and the usual endings", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111, 112].map(ordinalRank)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "111th", "112th",
    ]);
  });
  it("builds the profile line", () => {
    expect(communityRankLine(14, 38)).toBe("Community rank: 14th, on 38 boards");
    expect(communityRankLine(1, 1)).toBe("Community rank: 1st, on 1 board");
  });
});

describe("communityPageState", () => {
  const row = {
    eligible_boards: 30,
    eligible_accounts: 26,
    published: true,
    players_listed: 210,
    groups: ["offense", "defense"],
    built_at: "2026-09-26T08:00:00Z",
  };
  it("publishes only on the build's own flag", () => {
    expect(communityPageState(row, 25)).toEqual({
      kind: "published",
      boards: 30,
      playersListed: 210,
      groups: ["offense", "defense"],
    });
    expect(communityPageState({ ...row, published: false, eligible_boards: 12, eligible_accounts: 9 }, 25)).toEqual({
      kind: "building",
      boards: 12,
      people: 9,
      needed: 25,
    });
  });
  it("reads a format with no build yet as zero boards", () => {
    expect(communityPageState(null, 25)).toEqual({ kind: "building", boards: 0, people: 0, needed: 25 });
  });
  it("never says N of M with N at or past M while unpublished", () => {
    const state = communityPageState({ ...row, published: false, eligible_boards: 40, eligible_accounts: 27 }, 25);
    expect(state).toEqual({ kind: "building", boards: 40, people: 27, needed: 28 });
  });
  it("counts people, not boards, toward the threshold", () => {
    const state = communityPageState({ ...row, published: false, eligible_boards: 30, eligible_accounts: 3 }, 25);
    expect(state).toEqual({ kind: "building", boards: 30, people: 3, needed: 25 });
  });
  it("falls back to one group when the build listed none", () => {
    const state = communityPageState({ ...row, groups: [] }, 25);
    expect(state.kind === "published" && state.groups).toEqual(["all"]);
  });
});

describe("sortCommunityGroups and strengthPercent", () => {
  it("puts offense before defense", () => {
    expect(sortCommunityGroups(["defense", "offense"])).toEqual(["offense", "defense"]);
  });
  it("scales strength within the group with a floor", () => {
    expect(strengthPercent(2, 0, 2)).toBe(100);
    expect(strengthPercent(0, 0, 2)).toBe(4);
    expect(strengthPercent(1, 0, 2)).toBe(50);
    expect(strengthPercent(1, 1, 1)).toBe(100);
  });
});
