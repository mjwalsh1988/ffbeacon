import { describe, expect, it } from "vitest";
import type { DefenderRow } from "@/lib/ranking-boards/seed";
import { idpBasisText, rankDefenders } from "./rankings";

function row(
  playerId: string,
  position: string,
  projected: number | null,
  lastSeasonPoints: number | null,
): DefenderRow {
  return {
    playerId,
    slug: `${playerId}-slug`,
    name: `Player ${playerId}`,
    position,
    team: "KC",
    sleeperId: null,
    projected,
    lastSeasonPoints,
  };
}

// Two per position, listed so that position order and "projected first" both
// have to be imposed by rankDefenders rather than read off the input. The
// unprojected row in each pair has the BIGGER number on purpose: the two
// figures are on different scales and must never be interleaved.
const ROWS: DefenderRow[] = [
  row("db-last", "DB", null, 210),
  row("lb-last", "LB", null, 250),
  row("dl-proj", "DL", 80, null),
  row("db-proj", "DB", 60, 90),
  row("dl-last", "DL", null, 190),
  row("lb-proj", "LB", 95, 120),
];

describe("rankDefenders", () => {
  it("puts the projected row first in each position and numbers DL, LB, DB in order", () => {
    const ranked = rankDefenders(ROWS, 60);
    expect(ranked.map((r) => r.playerId)).toEqual([
      "dl-proj",
      "dl-last",
      "lb-proj",
      "lb-last",
      "db-proj",
      "db-last",
    ]);
    expect(ranked.map((r) => r.positionRank)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(ranked.map((r) => r.overallRank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ranked.map((r) => r.basis)).toEqual([
      "projected",
      "last_season",
      "projected",
      "last_season",
      "projected",
      "last_season",
    ]);
  });

  it("keeps only the first perPosition rows of each position", () => {
    const ranked = rankDefenders(ROWS, 1);
    expect(ranked.map((r) => r.playerId)).toEqual(["dl-proj", "lb-proj", "db-proj"]);
    expect(ranked.map((r) => r.overallRank)).toEqual([1, 2, 3]);
  });

  it("leaves out a defender with neither figure, as the seed does", () => {
    const ranked = rankDefenders([...ROWS, row("dl-none", "DL", null, null)], 60);
    expect(ranked.some((r) => r.playerId === "dl-none")).toBe(false);
  });

  it("attaches last season's finish and snap share when given them", () => {
    const ranked = rankDefenders(ROWS, 60, {
      finishes: new Map([["lb-proj", { finish: 4, of: 80 }]]),
      snapPct: new Map([["lb-proj", 97]]),
    });
    const lb = ranked.find((r) => r.playerId === "lb-proj");
    expect(lb?.lastSeasonFinish).toEqual({ finish: 4, of: 80 });
    expect(lb?.avgSnapPct).toBe(97);
    expect(ranked.find((r) => r.playerId === "dl-proj")?.lastSeasonFinish).toBeNull();
  });
});

describe("idpBasisText", () => {
  it("names both figures when the list holds both", () => {
    const text = idpBasisText(rankDefenders(ROWS, 60), 2025, true);
    expect(text).toContain("projected points for the rest of the season");
    expect(text).toContain("The 3 without a projection follow, ordered by their 2025 points.");
  });

  it("says the season is over when no projection window is open", () => {
    const ranked = rankDefenders([row("a", "LB", null, 100)], 60);
    expect(idpBasisText(ranked, 2026, false)).toContain("The season is over");
  });
});
