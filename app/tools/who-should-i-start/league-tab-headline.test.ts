/**
 * Unit tests for describeLeagueTabHeadline, the pure decision behind the
 * "Your lineup" tab's one-sentence headline (see league-tab-headline.ts).
 *
 * This repo has no React Testing Library set up (no @testing-library/react in
 * package.json; see components/manager-pulse/per-type-pair.test.tsx), so
 * these tests target the exported pure function rather than rendering
 * league-tab.tsx: no JSX, no DOM.
 *
 * Run directly with:
 *   npx vitest run app/tools/who-should-i-start/league-tab-headline.test.ts
 */

import { describe, expect, it } from "vitest";
import { describeLeagueTabHeadline, listNames, type Side } from "./league-tab-headline";
import type { BreakdownPlayer, LeagueImpact } from "@/lib/beacon-breakdown";

function player(name: string, slug = name.toLowerCase().replace(/\s+/g, "-")): BreakdownPlayer {
  return {
    slug,
    id: slug,
    name,
    position: "WR",
    team: "DET",
    teamPrimary: null,
    sleeperId: slug,
    age: null,
    ageDecimal: null,
    yearsExperience: null,
    injuryStatus: null,
    value: null,
    overallRank: null,
    positionRank: null,
    tier: null,
    change7d: null,
    change30d: null,
    change30dPct: null,
    change90dPct: null,
    trend30d: null,
    volatility30d: null,
    high30d: null,
    low30d: null,
    rankChange30d: null,
    latestFinish: null,
    recentFinishes: [],
    depthRole: null,
    depthOrder: null,
  };
}

function impact(overrides: Partial<LeagueImpact> = {}): LeagueImpact {
  return {
    netPointsPerWeek: 0,
    pointsPerStartedWeek: 0,
    weeksStarting: 0,
    weeksConsidered: 10,
    isBenchOnly: false,
    dropName: null,
    dropCostPerWeek: null,
    playoffOddsBefore: null,
    playoffOddsAfter: null,
    titleOddsBefore: null,
    titleOddsAfter: null,
    expectedWinsAdded: null,
    onYourRoster: false,
    rosteredBy: null,
    weeks: [],
    ...overrides,
  };
}

function side(name: string, impactOverrides: Partial<LeagueImpact> | null): Side {
  return {
    player: player(name),
    impact: impactOverrides === null ? null : impact(impactOverrides),
  };
}

describe("listNames", () => {
  it("returns one name as-is", () => {
    expect(listNames(["Bijan Robinson"])).toBe("Bijan Robinson");
  });

  it("joins two names with and, no comma", () => {
    expect(listNames(["Bijan Robinson", "Josh Jacobs"])).toBe("Bijan Robinson and Josh Jacobs");
  });

  it("joins three or more with a comma list and a trailing and", () => {
    expect(listNames(["A", "B", "C"])).toBe("A, B, and C");
    expect(listNames(["A", "B", "C", "D"])).toBe("A, B, C, and D");
  });
});

describe("describeLeagueTabHeadline", () => {
  it("returns empty when nothing is measured", () => {
    expect(describeLeagueTabHeadline([side("A", null), side("B", null)])).toEqual({
      kind: "empty",
    });
  });

  it("returns a single-player sentence when only one side is measured", () => {
    const plan = describeLeagueTabHeadline([
      side("Bijan Robinson", { netPointsPerWeek: 3.4, weeksStarting: 8, weeksConsidered: 10 }),
      side("No Data Guy", null),
    ]);
    expect(plan).toEqual({
      kind: "single",
      name: "Bijan Robinson",
      net: 3.4,
      weeksStarting: 8,
      weeksConsidered: 10,
    });
  });

  it("N equals 2, both bench-only: keeps the original 'neither' pairwise wording", () => {
    const plan = describeLeagueTabHeadline([
      side("Bijan Robinson", { isBenchOnly: true, netPointsPerWeek: 0 }),
      side("Josh Jacobs", { isBenchOnly: true, netPointsPerWeek: 0 }),
    ]);
    expect(plan).toEqual({
      kind: "all-bench",
      names: ["Bijan Robinson", "Josh Jacobs"],
      pairwise: true,
    });
  });

  it("N above 2, all bench-only: switches to the 'none of' group wording", () => {
    const plan = describeLeagueTabHeadline([
      side("A", { isBenchOnly: true }),
      side("B", { isBenchOnly: true }),
      side("C", { isBenchOnly: true }),
    ]);
    expect(plan).toEqual({
      kind: "all-bench",
      names: ["A", "B", "C"],
      pairwise: false,
    });
  });

  it("N equals 2, gap under the even threshold: 'effectively the same player'", () => {
    const plan = describeLeagueTabHeadline([
      side("Bijan Robinson", { netPointsPerWeek: 2.0 }),
      side("Josh Jacobs", { netPointsPerWeek: 1.9 }),
    ]);
    expect(plan).toEqual({
      kind: "pair-even",
      leaderName: "Bijan Robinson",
      trailerName: "Josh Jacobs",
      leaderNet: 2.0,
      trailerNet: 1.9,
    });
  });

  it("N equals 2, a real gap: names the leader and the trailer, in that order regardless of input order", () => {
    // Jacobs listed FIRST in the input but trails on points: the plan still
    // resolves Robinson as leader, proving the ranking is by value, not by
    // board position.
    const plan = describeLeagueTabHeadline([
      side("Josh Jacobs", { netPointsPerWeek: 1.0, weeksStarting: 4, weeksConsidered: 10 }),
      side("Bijan Robinson", { netPointsPerWeek: 3.5, weeksStarting: 9, weeksConsidered: 10 }),
    ]);
    expect(plan).toEqual({
      kind: "pair-lead",
      leaderName: "Bijan Robinson",
      trailerName: "Josh Jacobs",
      gap: 2.5,
      leaderNet: 3.5,
      trailerNet: 1.0,
      leaderWeeksStarting: 9,
      leaderWeeksConsidered: 10,
      trailerWeeksStarting: 4,
    });
  });

  it("N equals 8, a real gap: ranks by value and names only the top two, not all eight", () => {
    const eight = describeLeagueTabHeadline([
      side("Seventh", { netPointsPerWeek: 0.4 }),
      side("Leader", { netPointsPerWeek: 4.2, weeksStarting: 9, weeksConsidered: 10 }),
      side("Runner Up", { netPointsPerWeek: 3.0 }),
      side("Fourth", { netPointsPerWeek: 2.5 }),
      side("Fifth", { netPointsPerWeek: 2.1 }),
      side("Sixth", { netPointsPerWeek: 1.5 }),
      side("Eighth", { netPointsPerWeek: 0.1 }),
      side("Unmeasured", null),
    ]);
    expect(eight).toEqual({
      kind: "group-lead",
      leaderName: "Leader",
      secondName: "Runner Up",
      leaderNet: 4.2,
      secondNet: 3.0,
      leaderWeeksStarting: 9,
      leaderWeeksConsidered: 10,
    });
  });

  it("N above 2, gap under the even threshold: the group-even form, not the pair-even form", () => {
    const plan = describeLeagueTabHeadline([
      side("Leader", { netPointsPerWeek: 2.0 }),
      side("Runner Up", { netPointsPerWeek: 1.9 }),
      side("Third", { netPointsPerWeek: 0.5 }),
    ]);
    expect(plan).toEqual({
      kind: "group-even",
      leaderName: "Leader",
      secondName: "Runner Up",
      net: 2.0,
    });
  });
});
