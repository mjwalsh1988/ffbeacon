import { describe, expect, it } from "vitest";
import {
  builtAtIso,
  moneyPctText,
  moneyText,
  newestBuiltAt,
  pctText,
  readCell,
  sampleText,
  seasonsText,
  shareText,
} from "./faab-market-figures";
import type { PriorCell } from "@/lib/faab/priors-math";

function cell(overrides: Partial<PriorCell> = {}): PriorCell {
  return {
    cellKey: "chopped|any|any|alive_50p|any",
    leagueKind: "chopped",
    superflex: "any",
    position: "any",
    phase: "alive_50p",
    bidders: "any",
    sampleSize: 324,
    zeroShare: 0.432,
    p05: 0,
    p10: 0,
    p25: 0,
    p50: 0.2,
    p75: 3.2,
    p90: 20,
    p95: 33.7,
    p99: 60,
    runnerUpRatioP50: 1.4,
    leaguesCount: 16,
    seasons: [2025, 2026],
    builtAt: "2026-09-19 22:29:29.406+00",
    ...overrides,
  };
}

describe("readCell", () => {
  it("returns the named cell and marks it publishable", () => {
    const read = readCell([cell()], "chopped|any|any|alive_50p|any", 30);
    expect(read?.enough).toBe(true);
    expect(read?.p90).toBe(20);
  });

  it("marks a thin cell unpublishable rather than hiding it", () => {
    const read = readCell([cell({ sampleSize: 12 })], "chopped|any|any|alive_50p|any", 30);
    expect(read?.enough).toBe(false);
    expect(read?.sampleSize).toBe(12);
  });

  it("never falls back to a wider cell", () => {
    expect(readCell([cell()], "chopped|any|any|alive_lt30|any", 30)).toBeNull();
  });
});

describe("formatting", () => {
  it("keeps one decimal and never rounds a real bid to zero", () => {
    expect(pctText(20)).toBe("20");
    expect(pctText(10.5)).toBe("10.5");
    expect(pctText(33.666666)).toBe("33.7");
    expect(pctText(0.02)).toBe("under 0.1");
    expect(pctText(0)).toBe("0");
  });

  it("converts a share of the budget into the stated pot", () => {
    expect(moneyText(3.2, 1000)).toBe("$32");
    expect(moneyText(0.2, 1000)).toBe("$2");
    expect(moneyText(0.02, 1000)).toBe("under $1");
    expect(moneyPctText(20, 1000)).toBe("$200 (20%)");
  });

  it("reads a zero share as whole percent", () => {
    expect(shareText(0.432)).toBe("43");
  });

  it("names the seasons the way a sentence would", () => {
    expect(seasonsText([2025])).toBe("2025");
    expect(seasonsText([2025, 2026])).toBe("2025 and 2026");
    expect(seasonsText([2023, 2024, 2025, 2026])).toBe("2023 to 2026");
  });

  it("states the provenance of a figure", () => {
    expect(sampleText(readCell([cell()], "chopped|any|any|alive_50p|any", 30)!)).toBe(
      "324 claims, 16 leagues, 2025 and 2026",
    );
  });
});

describe("build stamps", () => {
  it("parses the Postgres rendering as well as ISO", () => {
    expect(Number.isNaN(new Date(builtAtIso("2026-09-19 22:29:29.406+00")).getTime())).toBe(false);
    expect(builtAtIso("2026-09-19T22:29:29.406+00:00")).toBe("2026-09-19T22:29:29.406+00:00");
  });

  it("takes the newest stamp and ignores missing ones", () => {
    const older = readCell([cell({ builtAt: "2026-09-01T00:00:00+00:00" })], "chopped|any|any|alive_50p|any", 30);
    const newer = readCell([cell({ builtAt: "2026-09-19T00:00:00+00:00" })], "chopped|any|any|alive_50p|any", 30);
    expect(newestBuiltAt([null, older, newer])).toBe("2026-09-19T00:00:00+00:00");
  });
});
