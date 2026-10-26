import { describe, expect, it } from "vitest";
import { ownershipHistory } from "./bits";

const TEAMS = {
  1: { sleeperRosterId: 1, teamName: "Gridiron Kings", ownerHandle: null, avatarId: null },
  2: { sleeperRosterId: 2, teamName: "Night Owls", ownerHandle: null, avatarId: null },
};

const weeks = (holders: (number | null)[]) =>
  holders.map((rosterId, i) => ({ week: i + 1, rosterId, points: 10 }));

describe("ownershipHistory", () => {
  it("says nothing when one holder had him every week and still has him", () => {
    expect(ownershipHistory(weeks([1, 1, 1]), TEAMS, 1)).toBeNull();
  });

  it("names every holder in full words", () => {
    expect(ownershipHistory(weeks([null, null, 1, 1]), TEAMS, 1)).toBe(
      "Free agent weeks 1 to 2, then Gridiron Kings weeks 3 to 4",
    );
  });

  it("still names a single earlier holder who has since let him go", () => {
    expect(ownershipHistory(weeks([2, 2]), TEAMS, null)).toBe("Night Owls weeks 1 to 2");
    expect(ownershipHistory(weeks([2]), TEAMS, 1)).toBe("Night Owls week 1");
  });
});
