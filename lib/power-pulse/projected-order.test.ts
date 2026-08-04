import { describe, expect, it } from "vitest";
import { compareProjectedFinish } from "./projected-order";

describe("compareProjectedFinish", () => {
  it("orders by expected wins, best first", () => {
    const teams = [
      { id: "c", projectedWins: 6.1, expectedPointsPerWeek: 130 },
      { id: "a", projectedWins: 9.4, expectedPointsPerWeek: 120 },
      { id: "b", projectedWins: 7.8, expectedPointsPerWeek: 125 },
    ];
    expect([...teams].sort(compareProjectedFinish).map((t) => t.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("breaks a tie on points per week, not on the original order", () => {
    const teams = [
      { id: "low", projectedWins: 8, expectedPointsPerWeek: 110 },
      { id: "high", projectedWins: 8, expectedPointsPerWeek: 140 },
    ];
    expect([...teams].sort(compareProjectedFinish).map((t) => t.id)).toEqual([
      "high",
      "low",
    ]);
  });

  it("treats a missing projection as the worst possible, not as a crash", () => {
    const teams = [
      { id: "unknown", projectedWins: null, expectedPointsPerWeek: null },
      { id: "known", projectedWins: 0.5, expectedPointsPerWeek: 90 },
    ];
    expect([...teams].sort(compareProjectedFinish).map((t) => t.id)).toEqual([
      "known",
      "unknown",
    ]);
  });

  it("does not reorder a strong roster above a team with more expected wins", () => {
    // The whole reason this order is not Power Pulse order: the roster with the
    // higher weekly ceiling can still finish below one with an easier schedule.
    const teams = [
      { id: "hard-schedule", projectedWins: 7.2, expectedPointsPerWeek: 145 },
      { id: "easy-schedule", projectedWins: 8.9, expectedPointsPerWeek: 118 },
    ];
    expect([...teams].sort(compareProjectedFinish)[0]?.id).toBe("easy-schedule");
  });
});
