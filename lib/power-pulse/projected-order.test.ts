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

  it("settles a dead-level tie on roster id, not on the order the rows arrived in", () => {
    // Both surfaces sort rows from an unordered read. Two teams level on wins
    // and points must land the same way on the league row and the league page,
    // so the comparator has to decide it rather than leave it to the database.
    const a = { id: "a", projectedWins: 8, expectedPointsPerWeek: 120, rosterId: "aaa" };
    const b = { id: "b", projectedWins: 8, expectedPointsPerWeek: 120, rosterId: "bbb" };
    expect([a, b].sort(compareProjectedFinish).map((t) => t.id)).toEqual(["a", "b"]);
    expect([b, a].sort(compareProjectedFinish).map((t) => t.id)).toEqual(["a", "b"]);
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
