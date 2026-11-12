import { describe, expect, it } from "vitest";
import { mergeSeasonCells, pickCell, type PriorCell } from "./priors-math";

function cell(over: Partial<PriorCell> = {}): PriorCell {
  return {
    cellKey: "redraft|no|RB|wk2_6|2",
    leagueKind: "redraft",
    superflex: "no",
    position: "RB",
    phase: "wk2_6",
    bidders: "2",
    sampleSize: 100,
    zeroShare: 0.2,
    p05: 0,
    p10: 1,
    p25: 3,
    p50: 6,
    p75: 10,
    p90: 15,
    p95: 20,
    p99: 30,
    runnerUpRatioP50: 1.4,
    leaguesCount: 20,
    seasons: [2026],
    builtAt: "2026-11-12T00:00:00.000Z",
    season: 2026,
    fromPriorSeason: false,
    ...over,
  };
}

describe("mergeSeasonCells", () => {
  it("uses this season's cell once it has enough samples, and never last season's", () => {
    const merged = mergeSeasonCells(
      [cell({ sampleSize: 30, p50: 6 }), cell({ season: 2025, seasons: [2025], sampleSize: 900, p50: 2 })],
      30,
      2026,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].season).toBe(2026);
    expect(merged[0].fromPriorSeason).toBe(false);
    expect(merged[0].p50).toBe(6);
  });

  it("uses last season's cell while this season's is thin", () => {
    const merged = mergeSeasonCells(
      [cell({ sampleSize: 4 }), cell({ season: 2025, seasons: [2025], sampleSize: 200, p50: 2 })],
      30,
      2026,
    );
    expect(merged[0].season).toBe(2025);
    expect(merged[0].fromPriorSeason).toBe(true);
    expect(merged[0].p50).toBe(2);
  });

  it("uses last season's cell while this season's is thin, even when last season's is thin too", () => {
    const merged = mergeSeasonCells([cell({ sampleSize: 10 }), cell({ season: 2025, sampleSize: 12 })], 30, 2026);
    expect(merged[0].season).toBe(2025);
    expect(merged[0].fromPriorSeason).toBe(true);
  });

  it("uses last season's cell when this season has none for the key", () => {
    const merged = mergeSeasonCells(
      [cell({ cellKey: "any|any|any|any|any" }), cell({ season: 2025, sampleSize: 5 })],
      30,
      2026,
    );
    const borrowed = merged.find((c) => c.cellKey === "redraft|no|RB|wk2_6|2");
    expect(borrowed?.fromPriorSeason).toBe(true);
  });

  it("keeps this season's thin cell when last season has no cell for the key", () => {
    const merged = mergeSeasonCells([cell({ sampleSize: 10 })], 30, 2026);
    expect(merged[0].season).toBe(2026);
    expect(merged[0].fromPriorSeason).toBe(false);
  });

  it("never reaches back more than one season", () => {
    const merged = mergeSeasonCells(
      [cell({ sampleSize: 2 }), cell({ season: 2024, seasons: [2024], sampleSize: 5000 })],
      30,
      2026,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].season).toBe(2026);
  });

  it("labels every cell borrowed when the new season has no cells yet", () => {
    // January: a dynasty league has renewed under 2027 before 2027 has a single
    // claim. Inferring the season from the cells would call 2026 this season.
    const merged = mergeSeasonCells([cell({ season: 2026, sampleSize: 500 })], 30, 2027);
    expect(merged).toHaveLength(1);
    expect(merged[0].season).toBe(2026);
    expect(merged[0].fromPriorSeason).toBe(true);
  });

  it("falls back to the newest stored season only when no league exists", () => {
    const merged = mergeSeasonCells(
      [cell({ season: 2025, sampleSize: 50 }), cell({ season: 2024, sampleSize: 500 })],
      30,
      null,
    );
    expect(merged[0].season).toBe(2025);
    expect(merged[0].fromPriorSeason).toBe(false);
  });

  it("returns an empty list for no cells", () => {
    expect(mergeSeasonCells([], 30, 2026)).toEqual([]);
  });
});

describe("pickCell with a borrowed cell", () => {
  const want = {
    leagueKind: "redraft" as const,
    superflex: false,
    position: "RB",
    phase: "wk2_6",
    bidders: "2" as const,
  };

  it("names last season when the exact cell is borrowed", () => {
    const cells = mergeSeasonCells(
      [cell({ sampleSize: 3 }), cell({ season: 2025, seasons: [2025], sampleSize: 80 })],
      30,
      2026,
    );
    const picked = pickCell(cells, want, 30);
    expect(picked?.cell.season).toBe(2025);
    expect(picked?.fellBackTo).toBe("2025 claims until this season has enough");
  });

  it("names both the widening and the season when both happen", () => {
    const cells = mergeSeasonCells(
      [
        cell({ season: 2025, seasons: [2025], cellKey: "redraft|no|any|wk2_6|2", position: "any", sampleSize: 80 }),
      ],
      30,
      2026,
    );
    // A single season in the table is "this season", so build the borrowed
    // state explicitly, as the merge would for a thin current cell.
    const borrowed = cells.map((c) => ({ ...c, fromPriorSeason: true }));
    const picked = pickCell(borrowed, want, 30);
    expect(picked?.fellBackTo).toBe("every position, from 2025 claims until this season has enough");
  });

  it("says nothing about seasons for this season's own cell", () => {
    const picked = pickCell([cell()], want, 30);
    expect(picked?.fellBackTo).toBeNull();
  });
});
