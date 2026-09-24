import { describe, expect, it } from "vitest";
import { ungradedDefenderSlots } from "./build";

function entry(position: string, projected: number | null, actual: number | null, playerId: string | null = "p") {
  return { player: { playerId, position, projected, actual } };
}

describe("ungradedDefenderSlots (IDP-122 review)", () => {
  const groups = [
    { entries: [entry("QB", 20, null), entry("LB", null, null), entry("DB", null, 9), { player: null }] },
    { entries: [entry("LB", null, null, null)] },
  ];

  it("counts named defenders the week cannot grade, and no one else", () => {
    // Unplayed week: both defenders lack a projection; the unmatched row is not named.
    expect(ungradedDefenderSlots(groups, false)).toBe(2);
  });

  it("does not count a defender who has an actual score on a settled week", () => {
    expect(ungradedDefenderSlots(groups, true)).toBe(1);
  });
});
