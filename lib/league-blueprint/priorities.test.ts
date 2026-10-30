import { describe, expect, it } from "vitest";
import { computePriorities, type PriorityInput } from "./priorities";
import type { BlueprintGrade } from "./types";

const g = (key: "QB" | "RB" | "WR" | "TE", grade: number, valueRank: number): BlueprintGrade => ({
  key,
  label: key,
  grade,
  valueRank,
  pointsRank: null,
  reason: "",
});

const quiet: PriorityInput = {
  teamCount: 12,
  direction: "balanced",
  positional: [g("QB", 7, 4), g("RB", 6, 5), g("WR", 8, 2), g("TE", 5, 6)],
  needs: [],
  sellShare: 0,
  sellNames: [],
  ledger: null,
  bench: { grade: 6, rank: 5 },
  picks: { grade: 5, rank: 7, seasons: [2027, 2028] },
  ageGap: 0.2,
  mineAge: 26.1,
  activityBand: "Moderate",
  risers: [],
  windowLabel: "30 days",
  buildNames: ["Ja'Marr Chase", "Bijan Robinson"],
  totalValue: 61234,
  valueRank: 3,
};

const ids = (input: PriorityInput) => computePriorities(input, 3).map((p) => p.id);
const text = (input: PriorityInput, id: string) =>
  computePriorities(input, 12).find((p) => p.id === id)?.text ?? null;

describe("computePriorities", () => {
  it("always returns three on a quiet roster, fallback included", () => {
    expect(ids(quiet)).toEqual(["P10", "P11", "P12"]);
  });

  it("P1 fires on a grade of 4 or less and cites grade and rank", () => {
    const input = { ...quiet, positional: [g("QB", 7, 4), g("RB", 3, 10), g("WR", 8, 2), g("TE", 5, 6)] };
    expect(text(input, "P1")).toBe("Fix running back: graded 3 of 10, 10th of 12 in value.");
    expect(text(quiet, "P1")).toBeNull();
  });

  it("P2 fires only for a win-now roster with a need", () => {
    const input = { ...quiet, direction: "win-now" as const, needs: [{ position: "TE", need: 2.34 }] };
    expect(text(input, "P2")).toBe("Upgrade tight end: the lineup is 2.3 points a week short there.");
    expect(text({ ...input, direction: "balanced" }, "P2")).toBeNull();
  });

  it("P3 fires for a rebuilder with a quarter of the roster to sell", () => {
    const input = { ...quiet, direction: "rebuild" as const, sellShare: 0.3, sellNames: ["A", "B"] };
    expect(text(input, "P3")).toBe("Sell 2 veterans while they still start: A and B.");
    expect(text({ ...input, sellShare: 0.2 }, "P3")).toBeNull();
  });

  it("P4 fires under 90% efficiency with four graded weeks", () => {
    const input = {
      ...quiet,
      ledger: { efficiency: 0.86, gradedWeeks: 6, pointsLeftPerWeek: 11.42, efficiencyRank: 9 },
    };
    expect(text(input, "P4")).toBe("Set better lineups: 11.4 points a week left on the bench, 9th of 12.");
    expect(text({ ...input, ledger: { ...input.ledger, gradedWeeks: 3 } }, "P4")).toBeNull();
  });

  it("P5 and P6 fire for a win-now roster", () => {
    const input = {
      ...quiet,
      direction: "win-now" as const,
      bench: { grade: 3, rank: 11 },
      picks: { grade: 9, rank: 2, seasons: [2027, 2028] },
    };
    expect(text(input, "P5")).toBe("Add depth: bench value ranks 11th of 12.");
    expect(text(input, "P6")).toBe(
      "Spend draft capital: 2027 and 2028 picks rank 2nd of 12 and a contender does not need them.",
    );
  });

  it("P7 fires when 1.5 years older than the league", () => {
    const input = { ...quiet, ageGap: -1.8, mineAge: 27.9 };
    expect(text(input, "P7")).toBe("Get younger: the roster averages 27.9, 1.8 years older than the league.");
    expect(text({ ...input, direction: "rebuild" }, "P7")).toBeNull();
  });

  it("P8 fires on a Low band but never beside an action priority", () => {
    expect(text({ ...quiet, activityBand: "Low" }, "P8")).not.toBeNull();
    const withAction = { ...quiet, activityBand: "Low" as const, ageGap: -2, mineAge: 28 };
    expect(text(withAction, "P8")).toBeNull();
  });

  it("P9 fires for a rebuilder with two risers and cites each move", () => {
    const input = {
      ...quiet,
      direction: "rebuild" as const,
      risers: [
        { name: "A", pct: 18.24 },
        { name: "B", pct: 12 },
      ],
    };
    expect(text(input, "P9")).toBe("Ride the risers: A gained 18.2% and B gained 12.0% in 30 days.");
  });

  it("orders by weight", () => {
    const input = {
      ...quiet,
      direction: "win-now" as const,
      needs: [{ position: "RB", need: 3 }],
      positional: [g("QB", 7, 4), g("RB", 2, 11), g("WR", 8, 2), g("TE", 5, 6)],
    };
    expect(ids(input)).toEqual(["P1", "P2", "P10"]);
  });

  it("every rendered sentence names a number or a player", () => {
    for (const p of computePriorities({ ...quiet, activityBand: "High" }, 12)) {
      expect(/\d|Chase|Robinson/.test(p.text)).toBe(true);
    }
  });
});
