import { describe, it, expect } from "vitest";
import { computeVerdict } from "./trade-analyzer";

type Side = Parameters<typeof computeVerdict>[0][number];

const side = (rosterId: number, totalValue: number): Side => ({
  rosterId,
  teamName: `Team ${rosterId}`,
  ownerHandle: null,
  players: [],
  picks: [],
  totalValue,
});

describe("computeVerdict on the shared value percent", () => {
  it("keeps the labels the larger-side thresholds gave", () => {
    // 5% of the larger side is the even line, 15% the slight-edge line.
    expect(computeVerdict([side(1, 1000), side(2, 951)]).label).toBe("Even trade");
    expect(computeVerdict([side(1, 1000), side(2, 949)]).label).toBe("Slight edge");
    expect(computeVerdict([side(1, 1000), side(2, 851)]).label).toBe("Slight edge");
    expect(computeVerdict([side(1, 1000), side(2, 849)]).label).toBe("Won the trade");
  });

  it("prints the percent as |A - B| / (A + B)", () => {
    const verdict = computeVerdict([side(1, 6000), side(2, 4000)]);
    expect(verdict.differentialPct).toBeCloseTo(20, 2);
  });

  it("gives a three-team trade no verdict rather than a wrong one", () => {
    expect(computeVerdict([side(1, 5000), side(2, 3000), side(3, 1000)]).label).toBe("No verdict");
  });
});
