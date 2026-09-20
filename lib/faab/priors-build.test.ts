import { describe, expect, it } from "vitest";

import {
  biddersKey,
  buildPriorCells,
  choppedPhase,
  percentile,
  standardPhase,
  type PriorAuction,
} from "./priors-build";

function auction(over: Partial<PriorAuction> = {}): PriorAuction {
  return {
    leagueKind: "redraft",
    superflex: false,
    position: "RB",
    week: 3,
    aliveFraction: null,
    bidderCount: 2,
    winningPct: 10,
    runnerUpPct: 5,
    leagueId: "league-a",
    season: 2025,
    ...over,
  };
}

function cell(rows: ReturnType<typeof buildPriorCells>, key: string) {
  const found = rows.find((r) => r.cell_key === key);
  expect(found, `expected a cell for ${key}`).toBeTruthy();
  return found!;
}

describe("phases", () => {
  it("bands the standard season the way the measured prices do", () => {
    expect(standardPhase(1)).toBe("wk1");
    expect(standardPhase(2)).toBe("wk2_6");
    expect(standardPhase(6)).toBe("wk2_6");
    expect(standardPhase(7)).toBe("wk7_10");
    expect(standardPhase(11)).toBe("wk11_13");
    expect(standardPhase(14)).toBe("wk14p");
    expect(standardPhase(18)).toBe("wk14p");
  });

  it("has no phase for week 0, which is the offseason", () => {
    expect(standardPhase(0)).toBeNull();
  });

  it("bands a chopped season by how much of the field is left", () => {
    expect(choppedPhase(1)).toBe("alive_50p");
    expect(choppedPhase(0.5)).toBe("alive_50p");
    expect(choppedPhase(0.49)).toBe("alive_30_50");
    expect(choppedPhase(0.3)).toBe("alive_30_50");
    expect(choppedPhase(0.29)).toBe("alive_lt30");
    expect(choppedPhase(null)).toBeNull();
  });
});

describe("biddersKey", () => {
  it("buckets four or more together, where the prices stop separating", () => {
    expect(biddersKey(1)).toBe("1");
    expect(biddersKey(2)).toBe("2");
    expect(biddersKey(3)).toBe("3");
    expect(biddersKey(4)).toBe("4p");
    expect(biddersKey(20)).toBe("4p");
  });
});

describe("percentile", () => {
  it("is nearest-rank", () => {
    const sorted = [1, 2, 3, 4, 5];
    expect(percentile(sorted, 0.5)).toBe(3);
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(sorted, 1)).toBe(5);
  });

  it("is zero on an empty sample rather than undefined", () => {
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("buildPriorCells", () => {
  it("emits the exact cell and every coarser rollup of it", () => {
    const rows = buildPriorCells([auction()]);
    expect(rows.some((r) => r.cell_key === "redraft|no|RB|wk2_6|2")).toBe(true);
    expect(rows.some((r) => r.cell_key === "any|any|any|any|any")).toBe(true);
    expect(rows.some((r) => r.cell_key === "any|any|RB|any|any")).toBe(true);
    // One auction, five two-valued dimensions: 32 cells.
    expect(rows).toHaveLength(32);
  });

  it("puts the quantiles in share-of-budget terms, in order", () => {
    const rows = buildPriorCells(
      [5, 10, 15, 20, 40].map((pct) => auction({ winningPct: pct, runnerUpPct: null })),
    );
    const all = cell(rows, "any|any|any|any|any");
    expect(all.sample_size).toBe(5);
    expect(all.p50).toBe(15);
    expect(all.p90).toBe(40);
    expect(all.p25).toBeLessThanOrEqual(all.p50);
    expect(all.p50).toBeLessThanOrEqual(all.p75);
  });

  it("reports the share of auctions won at nothing", () => {
    const rows = buildPriorCells([
      auction({ winningPct: 0, runnerUpPct: null }),
      auction({ winningPct: 0, runnerUpPct: null }),
      auction({ winningPct: 10 }),
      auction({ winningPct: 20 }),
    ]);
    expect(cell(rows, "any|any|any|any|any").zero_share).toBe(0.5);
  });

  it("clamps a bid recorded above the league budget instead of trusting it", () => {
    const rows = buildPriorCells([auction({ winningPct: 250, runnerUpPct: null })]);
    expect(cell(rows, "any|any|any|any|any").p50).toBe(100);
  });

  it("measures the winner against the runner-up", () => {
    const rows = buildPriorCells([
      auction({ winningPct: 20, runnerUpPct: 10 }),
      auction({ winningPct: 30, runnerUpPct: 10 }),
      auction({ winningPct: 8, runnerUpPct: 4 }),
    ]);
    expect(cell(rows, "any|any|any|any|any").runner_up_ratio_p50).toBe(2);
  });

  it("has no runner-up ratio when nobody else bid", () => {
    const rows = buildPriorCells([auction({ runnerUpPct: null, bidderCount: 1 })]);
    expect(cell(rows, "any|any|any|any|any").runner_up_ratio_p50).toBeNull();
  });

  it("keeps a dynasty week 1 claim out of the phase cells, because it is an offseason claim", () => {
    const rows = buildPriorCells([
      auction({ leagueKind: "dynasty", week: 1, winningPct: 60, runnerUpPct: null }),
    ]);
    expect(rows.some((r) => r.phase === "wk1")).toBe(false);
    // It still counts toward what dynasty leagues pay overall.
    expect(cell(rows, "dynasty|any|any|any|any").sample_size).toBe(1);
  });

  it("keeps a redraft week 1 claim in its phase, where it belongs", () => {
    const rows = buildPriorCells([auction({ week: 1 })]);
    expect(rows.some((r) => r.phase === "wk1")).toBe(true);
  });

  it("files a chopped auction by teams alive, never by week", () => {
    const rows = buildPriorCells([
      auction({ leagueKind: "chopped", week: 6, aliveFraction: 0.35, winningPct: 12 }),
    ]);
    expect(rows.some((r) => r.cell_key.startsWith("chopped|no|RB|alive_30_50"))).toBe(true);
    expect(rows.some((r) => r.phase === "wk2_6")).toBe(false);
  });

  it("files a superflex league separately and in the rollup", () => {
    const rows = buildPriorCells([auction({ superflex: true, position: "QB" })]);
    expect(rows.some((r) => r.cell_key === "redraft|yes|QB|wk2_6|2")).toBe(true);
    expect(cell(rows, "any|any|any|any|any").sample_size).toBe(1);
  });

  it("files an unknown position only under any, never inventing one", () => {
    const rows = buildPriorCells([auction({ position: "LB" })]);
    expect(rows.every((r) => r.position === "any")).toBe(true);
  });

  it("counts distinct leagues and seasons without storing either", () => {
    const rows = buildPriorCells([
      auction({ leagueId: "a", season: 2024 }),
      auction({ leagueId: "a", season: 2025 }),
      auction({ leagueId: "b", season: 2025 }),
    ]);
    const all = cell(rows, "any|any|any|any|any");
    expect(all.leagues_count).toBe(2);
    expect(all.seasons).toEqual([2024, 2025]);
    expect(JSON.stringify(all)).not.toContain("league-a");
  });

  it("publishes no identifier of any kind", () => {
    const rows = buildPriorCells([auction({ leagueId: "secret-league-id" })]);
    expect(JSON.stringify(rows)).not.toContain("secret-league-id");
  });

  it("returns nothing for no auctions", () => {
    expect(buildPriorCells([])).toEqual([]);
  });
});
