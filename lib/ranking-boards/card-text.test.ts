import { describe, expect, it } from "vitest";
import { ageOn, finishScoringFor, finishesSentence } from "./card-text";

describe("card text", () => {
  it("computes whole years, before and after the birthday", () => {
    const now = new Date("2026-09-26T12:00:00Z");
    expect(ageOn("2000-09-26", now)).toBe(26);
    expect(ageOn("2000-09-27", now)).toBe(25);
    expect(ageOn(null, now)).toBeNull();
    expect(ageOn("not a date", now)).toBeNull();
  });

  it("maps scoring types to the finishes column", () => {
    expect(finishScoringFor("ppr")).toBe("pts_ppr");
    expect(finishScoringFor("half_ppr")).toBe("pts_half_ppr");
    expect(finishScoringFor("standard")).toBe("pts_std");
  });

  it("says rookie and no-finish in words", () => {
    expect(finishesSentence({ position: "WR", finishes: [], rookie: true })).toBe(
      "rookie, no NFL finishes",
    );
    expect(
      finishesSentence({
        position: "WR",
        finishes: [
          { season: 2025, finish: 12 },
          { season: 2024, finish: 24 },
        ],
        rookie: false,
      }),
    ).toBe("finished WR12 in 2025, WR24 in 2024");
  });
});
