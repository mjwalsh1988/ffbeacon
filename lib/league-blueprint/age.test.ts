import { describe, expect, it } from "vitest";
import { computeAge } from "./age";

describe("computeAge", () => {
  const mine = [
    { position: "RB", value: 6000, age: 23 },
    { position: "RB", value: 2000, age: 27 },
    { position: "WR", value: 4000, age: 25 },
    { position: "QB", value: null, age: 35 },
    { position: "LB", value: null, age: 24 },
  ];
  const league = [...mine, { position: "RB", value: 8000, age: 27 }, { position: "WR", value: 4000, age: 29 }];

  it("weights by value", () => {
    const out = computeAge(mine, league, 25);
    const rb = out.rows.find((r) => r.position === "RB")!;
    // (6000*23 + 2000*27) / 8000 = 24
    expect(rb.mine).toBe(24);
    // league: (6000*23 + 2000*27 + 8000*27) / 16000 = 25.5
    expect(rb.league).toBe(25.5);
    expect(rb.count).toBe(2);
  });

  it("reports a positive gap when younger than the league", () => {
    const rb = computeAge(mine, league, 25).rows.find((r) => r.position === "RB")!;
    expect(rb.gap).toBe(1.5);
  });

  it("is null for a position with no priced player", () => {
    const qb = computeAge(mine, league, 25).rows.find((r) => r.position === "QB")!;
    expect(qb.mine).toBeNull();
    expect(qb.gap).toBeNull();
    expect(qb.count).toBe(0);
  });

  it("computes the young core share over priced value", () => {
    // aged 25 or under: 6000 + 4000 of 12000
    expect(computeAge(mine, league, 25).youngCoreShare).toBeCloseTo(10000 / 12000, 6);
  });
});
