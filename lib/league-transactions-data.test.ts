import { describe, expect, it } from "vitest";
import { countTransactionFacets } from "./league-transactions-data";

describe("countTransactionFacets", () => {
  it("leaves failed claims out of type and week counts", () => {
    const { typeCounts, weeks } = countTransactionFacets([
      { type: "waiver", week: 1, status: "complete" },
      { type: "waiver", week: 2, status: "failed" },
      { type: "waiver", week: 2, status: "FAILED" },
      { type: "trade", week: 3, status: null },
    ]);
    expect(typeCounts.get("waiver")).toBe(1);
    expect(typeCounts.get("trade")).toBe(1);
    expect([...weeks].sort()).toEqual([1, 3]);
  });
});
