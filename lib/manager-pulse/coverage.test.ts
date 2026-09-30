import { describe, it, expect } from "vitest";
import { describeReportCoverage } from "./coverage";

describe("describeReportCoverage", () => {
  it("says nothing when nothing was missed", () => {
    const c = describeReportCoverage({ leagueSeasonsSkipped: 0, leagueSeasonsFailed: 0 }, 12);
    expect(c.complete).toBe(true);
    expect(c.sentence).toBeNull();
  });

  it("treats a report cached before the failed count existed as complete", () => {
    const c = describeReportCoverage({ leagueSeasonsSkipped: 0 }, 12);
    expect(c.complete).toBe(true);
  });

  it("names failed league-seasons and the total found", () => {
    const c = describeReportCoverage({ leagueSeasonsSkipped: 0, leagueSeasonsFailed: 2 }, 40);
    expect(c.complete).toBe(false);
    expect(c.sentence).toContain("covers 40 of the 42 league-seasons");
    expect(c.sentence).toContain("2 league-seasons could not be read");
  });

  it("names cap-skipped league-seasons separately, with singular wording", () => {
    const c = describeReportCoverage({ leagueSeasonsSkipped: 1, leagueSeasonsFailed: 1 }, 10);
    expect(c.sentence).toContain("covers 10 of the 12 league-seasons");
    expect(c.sentence).toContain("1 league-season could not be read from Sleeper this time, so nothing from it is counted.");
    expect(c.sentence).toContain("1 league-season was left out");
  });

  it("uses only plain ASCII punctuation", () => {
    const c = describeReportCoverage({ leagueSeasonsSkipped: 3, leagueSeasonsFailed: 5 }, 10);
    expect(/^[\x20-\x7E]*$/.test(c.sentence ?? "")).toBe(true);
  });
});
