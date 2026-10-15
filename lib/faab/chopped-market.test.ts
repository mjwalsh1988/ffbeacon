import { describe, expect, it } from "vitest";
import type { PriorCell } from "@/lib/faab/priors-math";
import { builtAtIso } from "@/lib/guides/faab-market-figures";
import { BAND_LABELS, CHOPPED_OVERALL_KEY, buildChoppedMarket } from "./chopped-market";

function cell(cellKey: string, overrides: Partial<PriorCell> = {}): PriorCell {
  return {
    cellKey,
    leagueKind: "chopped",
    superflex: "any",
    position: "any",
    phase: "any",
    bidders: "any",
    sampleSize: 200,
    zeroShare: 0.4,
    p05: 0,
    p10: 0,
    p25: 0,
    p50: 1,
    p75: 4,
    p90: 12,
    p95: 20,
    p99: 50,
    runnerUpRatioP50: 1.3,
    leaguesCount: 20,
    seasons: [2025, 2026],
    builtAt: "2026-10-01 12:00:00+00",
    ...overrides,
  };
}

describe("buildChoppedMarket", () => {
  it("returns the three bands in order and the overall read", () => {
    const cells = [
      ...BAND_LABELS.map((band, i) => cell(band.key, { p50: i + 1 })),
      cell(CHOPPED_OVERALL_KEY, { p50: 9, builtAt: "2026-10-02 12:00:00+00" }),
    ];
    const market = buildChoppedMarket(cells, 30);
    expect(market.bands.map((b) => b.label)).toEqual(BAND_LABELS.map((b) => b.label));
    expect(market.bands.map((b) => b.read?.p50)).toEqual([1, 2, 3]);
    expect(market.overall?.p50).toBe(9);
    // The newest build stamp across every cell read, which here is the overall cell.
    expect(market.updatedAt).toBe(builtAtIso("2026-10-02 12:00:00+00"));
  });

  it("keeps a row for a band with no cell instead of dropping it", () => {
    const market = buildChoppedMarket([cell(CHOPPED_OVERALL_KEY)], 30);
    expect(market.bands).toHaveLength(3);
    expect(market.bands.every((b) => b.read === null)).toBe(true);
    expect(market.overall).not.toBeNull();
  });

  it("marks a thin band unpublishable", () => {
    const market = buildChoppedMarket([cell(BAND_LABELS[0].key, { sampleSize: 5 })], 30);
    expect(market.bands[0].read?.enough).toBe(false);
  });
});
