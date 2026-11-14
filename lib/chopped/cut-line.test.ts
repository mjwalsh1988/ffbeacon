import { describe, expect, it } from "vitest";
import { buildCutLineWeek, type CutLineTeam } from "./cut-line";

function team(rosterId: number, over: Partial<CutLineTeam> = {}): CutLineTeam {
  return {
    rosterId,
    teamName: `Team ${rosterId}`,
    score: null,
    expected: 100,
    sigma: 15,
    seasonPoints: 500,
    eliminatedWeek: null,
    ...over,
  };
}

describe("buildCutLineWeek", () => {
  it("frames a live week around the lowest other score", () => {
    const week = buildCutLineWeek({
      rosterId: 1,
      week: 6,
      isFinal: false,
      teams: [
        team(1, { score: 80, expected: 120, sigma: 5 }),
        team(2, { score: 60, expected: 70, sigma: 5 }),
        team(3, { score: 95, expected: 110, sigma: 5 }),
        // Chopped in week 3: not part of this week.
        team(4, { score: 0, expected: null, eliminatedWeek: 3 }),
      ],
    });
    expect(week.score).toBe(80);
    expect(week.lowestOther).toBe(60);
    expect(week.lowestTeamName).toBe("Team 2");
    expect(week.margin).toBe(20);
    expect(week.aliveCount).toBe(3);
    expect(week.survivalChance).toBeGreaterThan(0.95);
  });

  it("settles a final week from the elimination record, not a simulation", () => {
    const base = [team(1, { score: 70 }), team(2, { score: 90 })];
    expect(
      buildCutLineWeek({ rosterId: 1, week: 6, isFinal: true, teams: [{ ...base[0], eliminatedWeek: 6 }, base[1]] })
        .survivalChance,
    ).toBe(0);
    expect(buildCutLineWeek({ rosterId: 2, week: 6, isFinal: true, teams: base }).survivalChance).toBe(1);
  });

  it("says a team chopped earlier is already out", () => {
    const week = buildCutLineWeek({
      rosterId: 1,
      week: 8,
      isFinal: false,
      teams: [team(1, { eliminatedWeek: 5 }), team(2), team(3)],
    });
    expect(week.alreadyOut).toBe(true);
    expect(week.survivalChance).toBeNull();
  });

  it("shows no scores before kickoff", () => {
    const week = buildCutLineWeek({
      rosterId: 1,
      week: 6,
      isFinal: false,
      teams: [team(1, { score: 0 }), team(2, { score: 0 })],
    });
    expect(week.score).toBeNull();
    expect(week.margin).toBeNull();
    expect(week.survivalChance).not.toBeNull();
  });
});
