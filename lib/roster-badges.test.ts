import { describe, expect, it } from "vitest";
import {
  DROP_CANDIDATE_COUNT,
  MIN_ELIGIBLE_FOR_DROPS,
  TOP_POSITION_RANK,
  dropBadgeLabel,
  dropCandidateIds,
  isDynastyStash,
  isTopAtPosition,
  topBadgeLabel,
  type BadgeCandidate,
} from "./roster-badges";

function player(
  id: string,
  value: number | null,
  extra: Partial<BadgeCandidate> = {},
): BadgeCandidate {
  return {
    id,
    value,
    isStarter: false,
    age: 28,
    yearsExperience: 6,
    positionRank: 40,
    ...extra,
  };
}

/** A bench of n veterans, valued 100, 200, 300 ... so order is obvious. */
function bench(
  n: number,
  extra: Partial<BadgeCandidate> = {},
): BadgeCandidate[] {
  return Array.from({ length: n }, (_, i) =>
    player(`p${i + 1}`, (i + 1) * 100, extra),
  );
}

describe("isTopAtPosition", () => {
  it("takes the top fourteen and nothing past it", () => {
    expect(isTopAtPosition(1)).toBe(true);
    expect(isTopAtPosition(TOP_POSITION_RANK)).toBe(true);
    expect(isTopAtPosition(TOP_POSITION_RANK + 1)).toBe(false);
  });

  it("treats an unranked player as unranked, not as rank zero", () => {
    expect(isTopAtPosition(null)).toBe(false);
    expect(isTopAtPosition(undefined)).toBe(false);
    expect(isTopAtPosition(0)).toBe(false);
  });
});

describe("isDynastyStash", () => {
  it("protects the young and the inexperienced", () => {
    expect(isDynastyStash(player("a", 100, { age: 23 }))).toBe(true);
    expect(
      isDynastyStash(player("b", 100, { age: 29, yearsExperience: 1 })),
    ).toBe(true);
  });

  it("does not protect an unknown age", () => {
    expect(
      isDynastyStash(player("c", 100, { age: null, yearsExperience: null })),
    ).toBe(false);
  });
});

describe("dropCandidateIds", () => {
  it("names the three cheapest on a redraft bench", () => {
    const ids = dropCandidateIds(bench(8), { isDynasty: false });
    expect([...ids].sort()).toEqual(["p1", "p2", "p3"]);
    expect(ids.size).toBe(DROP_CANDIDATE_COUNT);
  });

  it("stays silent on a roster too shallow to have a worst three", () => {
    const ids = dropCandidateIds(bench(MIN_ELIGIBLE_FOR_DROPS - 1), {
      isDynasty: false,
    });
    expect(ids.size).toBe(0);
  });

  it("never names a starter", () => {
    const roster = bench(8);
    roster[0].isStarter = true;
    roster[1].isStarter = true;
    const ids = dropCandidateIds(roster, { isDynasty: false });
    expect(ids.has("p1")).toBe(false);
    expect(ids.has("p2")).toBe(false);
    expect([...ids].sort()).toEqual(["p3", "p4", "p5"]);
  });

  it("never names a player who is top of the position", () => {
    const roster = bench(8);
    roster[0].positionRank = 3;
    const ids = dropCandidateIds(roster, { isDynasty: false });
    expect(ids.has("p1")).toBe(false);
  });

  it("ignores a player the source has no value for", () => {
    const roster = bench(8);
    roster[0].value = null;
    roster[1].value = 0;
    const ids = dropCandidateIds(roster, { isDynasty: false });
    expect(ids.has("p1")).toBe(false);
    expect(ids.has("p2")).toBe(false);
  });

  it("skips the young ones in dynasty and takes them in redraft", () => {
    const roster = bench(8);
    roster[0].age = 22;
    roster[1].yearsExperience = 0;

    expect([...dropCandidateIds(roster, { isDynasty: false })].sort()).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
    expect([...dropCandidateIds(roster, { isDynasty: true })].sort()).toEqual([
      "p3",
      "p4",
      "p5",
    ]);
  });

  it("returns what it has when dynasty protection thins the pool", () => {
    const roster = bench(8, { age: 22 });
    roster[7].age = 30;
    const ids = dropCandidateIds(roster, { isDynasty: true });
    expect([...ids]).toEqual(["p8"]);
  });

  it("breaks a value tie the same way every render", () => {
    const roster = bench(8).map((p) => ({ ...p, value: 100 }));
    const first = [...dropCandidateIds(roster, { isDynasty: false })].sort();
    const second = [
      ...dropCandidateIds([...roster].reverse(), { isDynasty: false }),
    ].sort();
    expect(first).toEqual(second);
  });
});

describe("badge copy", () => {
  it("names the player and the exact rank on the star", () => {
    const text = topBadgeLabel({
      name: "Jordan Reese",
      position: "RB",
      positionRank: 7,
    });
    expect(text).toContain("Jordan Reese");
    expect(text).toContain("RB7");
    expect(text).toContain("top 14");
  });

  it("states the dynasty rule only in dynasty", () => {
    const redraft = dropBadgeLabel({
      name: "Jordan Reese",
      isDynasty: false,
      excludesStarters: true,
    });
    const dynasty = dropBadgeLabel({
      name: "Jordan Reese",
      isDynasty: true,
      excludesStarters: true,
    });
    expect(redraft).not.toContain("dynasty");
    expect(dynasty).toContain("dynasty");
    expect(dynasty).toContain("23 or under");
  });

  it("does not claim a starting lineup in a draft room", () => {
    const text = dropBadgeLabel({
      name: "Jordan Reese",
      isDynasty: false,
      excludesStarters: false,
    });
    expect(text).not.toContain("starting lineup");
  });
});
