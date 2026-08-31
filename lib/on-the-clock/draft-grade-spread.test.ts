import { describe, it, expect } from "vitest";
import { computeDraftGrades } from "./draft-grade";
import type { DraftPulseTeam } from "./draft-pulse";
import type { TeamRollup } from "./rosters";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "./default-settings";

const SETTINGS = DEFAULT_ON_THE_CLOCK_SETTINGS.grades;
const SLOT_COUNT = 10;

function rollup(rosterId: number): TeamRollup {
  return {
    rosterId,
    ownerName: `owner-${rosterId}`,
    teamName: null,
    isYou: false,
    players: {} as TeamRollup["players"],
    positionTotals: {} as TeamRollup["positionTotals"],
    playersValue: 0,
    playerCount: 15,
    futurePicks: [],
    futurePicksValue: 0,
    totalValue: 0,
    rank: rosterId,
  } as unknown as TeamRollup;
}

function pulse(rosterId: number, points: number, filled: number): DraftPulseTeam {
  return {
    rosterId,
    meanStartingPoints: points,
    sigma: 25,
    rank: 1,
    score: 50,
    positionPoints: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 },
    weakestSlot: null,
    starterBeatRate: null,
    starterAvailability: null,
    starterWeeksPlayed: null,
    projectedCount: 15,
    unprojectedCount: 0,
    startersFilled: filled,
  };
}

function grade(teams: Array<{ id: number; points: number; filled: number }>) {
  return computeDraftGrades({
    rollups: teams.map((t) => rollup(t.id)),
    pulseTeams: teams.map((t) => pulse(t.id, t.points, t.filled)),
    pickSurpluses: [],
    tradeMarginByRoster: new Map(),
    startingSlotCount: SLOT_COUNT,
    isDynasty: false,
    settings: SETTINGS,
    inProgress: false,
  });
}

const constructionOf = (g: ReturnType<typeof computeDraftGrades>[number]) =>
  g.components.find((c) => c.key === "construction")?.score ?? null;

describe("roster construction, when nobody actually has a construction problem", () => {
  /**
   * The measured case. Every team in a real twelve-team league filled either
   * 9.9 or 10.0 of its ten starting slots, a one percent difference, and the
   * curve turned it into component scores of 41 and 90 carrying nearly a fifth
   * of each grade. The team with the second best starting lineup in the room
   * scored 41; the team with the worst scored 90.
   */
  const league = [
    { id: 1, points: 156, filled: 9.94 },
    { id: 2, points: 150, filled: 10 },
    { id: 3, points: 148, filled: 9.96 },
    { id: 4, points: 145, filled: 10 },
    { id: 5, points: 143, filled: 9.93 },
  ];

  it("does not spread teams across the scale over a fraction of a slot", () => {
    const scores = grade(league).map(constructionOf);
    const spread = Math.max(...(scores as number[])) - Math.min(...(scores as number[]));
    expect(spread).toBeLessThan(2);
  });

  it("still says everyone is essentially full, rather than saying nothing", () => {
    for (const g of grade(league)) {
      expect(constructionOf(g)).toBeGreaterThan(90);
    }
  });

  it("leaves the ordering to the components that can see a difference", () => {
    const graded = grade(league);
    // Lineup points are the only component with real spread here, so the
    // ordering must follow them.
    expect(graded.map((g) => g.rosterId)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("roster construction, when someone genuinely has a hole", () => {
  it("still separates a team that cannot fill its lineup", () => {
    const graded = grade([
      { id: 1, points: 150, filled: 10 },
      { id: 2, points: 150, filled: 10 },
      // Missing a starter in most weeks. This is the difference the component
      // exists to report, and it has to survive the guard.
      { id: 3, points: 150, filled: 9 },
    ]);
    const full = constructionOf(graded.find((g) => g.rosterId === 1)!)!;
    const short = constructionOf(graded.find((g) => g.rosterId === 3)!)!;
    expect(full - short).toBeGreaterThan(20);
  });

  it("drops a team with a real hole below its equals overall", () => {
    const graded = grade([
      { id: 1, points: 150, filled: 10 },
      { id: 2, points: 150, filled: 10 },
      { id: 3, points: 150, filled: 9 },
    ]);
    expect(graded[graded.length - 1].rosterId).toBe(3);
  });
});

describe("the starting lineup component", () => {
  it("does not manufacture a gap between teams that drafted the same", () => {
    // A tenth of a point a week between best and worst. Real leagues do not
    // look like this, and when one does the honest answer is that the draft
    // separated nobody.
    const graded = grade([
      { id: 1, points: 150.0, filled: 10 },
      { id: 2, points: 149.95, filled: 10 },
      { id: 3, points: 149.9, filled: 10 },
    ]);
    const lineup = graded.map(
      (g) => g.components.find((c) => c.key === "lineup")?.score ?? 0,
    );
    expect(Math.max(...lineup) - Math.min(...lineup)).toBeLessThan(2);
  });

  it("still curves a room that genuinely spread out", () => {
    const graded = grade([
      { id: 1, points: 165, filled: 10 },
      { id: 2, points: 150, filled: 10 },
      { id: 3, points: 138, filled: 10 },
    ]);
    const lineup = graded.map(
      (g) => g.components.find((c) => c.key === "lineup")?.score ?? 0,
    );
    expect(Math.max(...lineup) - Math.min(...lineup)).toBeGreaterThan(30);
  });
});
