import { describe, expect, it } from "vitest";
import {
  buildChartSummary,
  buildEmptyStateMessage,
  buildEmptyStateQuietNote,
  buildFootnote,
  buildLegendHeadline,
  buildNoProjectionLine,
  buildOverlayPositionLine,
  buildPastDepthLine,
} from "./summary";
import type { PositionCurve, WarCurvePoint } from "@/lib/positional-war/types";

function pointAt(rank: number, war: number): WarCurvePoint {
  return {
    playerId: `p${rank}`,
    sleeperId: `s${rank}`,
    slug: `p${rank}`,
    name: `Player ${rank}`,
    team: "AAA",
    injuryStatus: null,
    positionRank: rank,
    war,
    pointsAboveReplacement: war * 10,
    projectedPointsPerWeek: 20 - rank,
    replacementPointsPerWeek: 10,
    weeksProjected: 6,
  };
}

function curve(overrides: Partial<PositionCurve> & { position: PositionCurve["position"] }): PositionCurve {
  return {
    structuralDemand: 12,
    replacementPoints: 10,
    avgSeatedPoints: 12,
    deficit: 2,
    shallowPool: false,
    warRank1: 1.73,
    warAtDemand: 0.4,
    cliffRank: 6,
    curve: [pointAt(1, 1.73), pointAt(2, 1.2), pointAt(3, 0.6), pointAt(4, 0.3)],
    weeklyDiagnostics: [],
    ...overrides,
  };
}

describe("buildChartSummary", () => {
  it("names the scarcest and flattest position using only figures present in the input", () => {
    const rb = curve({ position: "RB", warRank1: 1.73, structuralDemand: 4 });
    const k = curve({
      position: "K",
      warRank1: 0.11,
      structuralDemand: 4,
      curve: [pointAt(1, 0.11), pointAt(2, 0.1), pointAt(3, 0.09), pointAt(4, 0.05)],
      cliffRank: null,
    });
    const summary = buildChartSummary([rb, k], 12);

    expect(summary).toContain("Running back is the scarcest position");
    expect(summary).toContain("1.73 wins");
    expect(summary).toContain("Kicker is the flattest");
    expect(summary).toContain("0.11 wins");
    expect(summary).toContain("12-team league");
    // Short enough to be worth hearing. The old version repeated the full
    // replacement definition on top of both findings.
    expect(summary.length).toBeLessThan(300);
  });

  it("omits the half-win clause's rank when the curve never drops below half a win", () => {
    const rb = curve({
      position: "RB",
      warRank1: 1,
      structuralDemand: 4,
      curve: [pointAt(1, 1), pointAt(2, 0.9), pointAt(3, 0.8), pointAt(4, 0.7)],
    });
    const summary = buildChartSummary([rb], 10);
    expect(summary).toContain("stays above half a win");
    expect(summary).not.toMatch(/passes half a win by RB\d/);
  });

  it("names only the scarcest position when fewer than two positions have a curve", () => {
    const summary = buildChartSummary([curve({ position: "QB" })], 10);
    expect(summary).toContain("Quarterback is the scarcest position");
    expect(summary).not.toContain("flattest");
  });

  it("never prints a fabricated 0.00 when there is nothing to summarize", () => {
    const summary = buildChartSummary([], 10);
    expect(summary).not.toContain("0.00");
    expect(summary).toContain("10-team league");
  });
});

describe("buildLegendHeadline", () => {
  it("carries the ranking as readable text", () => {
    const headline = buildLegendHeadline(curve({ position: "QB", warRank1: 0.65, structuralDemand: 12 }));
    expect(headline).toBe("QB: best is worth 0.65 wins, 12 start");
  });

  it("falls back to a plain label when there is no data yet", () => {
    const headline = buildLegendHeadline(curve({ position: "QB", warRank1: null, curve: [] }));
    expect(headline).toBe("QB: not enough data yet");
  });
});

describe("buildOverlayPositionLine", () => {
  it("reports the viewer's best player against the position's best", () => {
    const rb = curve({ position: "RB", warRank1: 1.73 });
    const line = buildOverlayPositionLine(rb, 6, 0.94);
    expect(line).toBe("Your best RB is RB6, worth 0.94 wins; RB1 is worth 1.73.");
  });

  it("says plainly when the viewer holds nobody at the position", () => {
    const te = curve({ position: "TE" });
    const line = buildOverlayPositionLine(te, null, null);
    expect(line).toBe("No ranked TE on your roster.");
  });
});

describe("trailing lines", () => {
  it("names players who rank past the chart's depth", () => {
    expect(buildPastDepthLine(["Player A", "Player B"])).toBe(
      "Yours, past the chart's depth: Player A, Player B.",
    );
    expect(buildPastDepthLine([])).toBeNull();
  });

  it("counts players with no projection without naming them", () => {
    expect(buildNoProjectionLine(1)).toBe("1 of your players has no projection, so it is not plotted.");
    expect(buildNoProjectionLine(2)).toBe("2 of your players have no projection, so they are not plotted.");
    expect(buildNoProjectionLine(0)).toBeNull();
  });
});

describe("buildFootnote", () => {
  const base = {
    fromWeek: 9,
    throughWeek: 14,
    scoringDescription: "Full PPR, TE premium +0.5",
    teamCount: 12,
    excludedSlots: [] as string[],
    shallowPositions: [] as PositionCurve["position"][],
    modelVersion: "war-1",
    generatedAt: "2026-08-26T11:30:00.000Z",
    isStale: false,
  };

  it("carries the week window, scoring, replacement definition, and calculation time from the input", () => {
    const footnote = buildFootnote(base);
    expect(footnote).toContain("Weeks 9 to 14");
    expect(footnote).toContain("Full PPR, TE premium +0.5");
    expect(footnote).toContain("12-team league");
    expect(footnote).toContain("model war-1");
    expect(footnote).not.toContain("Last calculated");
  });

  it("names excluded positions only when there are any", () => {
    const withExclusions = buildFootnote({ ...base, excludedSlots: ["LB", "DB"] });
    expect(withExclusions).toContain("Sleeper does not project LB, DB");
    const without = buildFootnote(base);
    expect(without).not.toContain("excluded");
  });

  it("adds a shallow-pool clause only for positions flagged shallow", () => {
    const shallow = buildFootnote({ ...base, shallowPositions: ["TE"] });
    expect(shallow).toContain("understates");
    const notShallow = buildFootnote(base);
    expect(notShallow).not.toContain("understates");
  });

  it("adds the staleness clause only when isStale is true, and never silently", () => {
    const stale = buildFootnote({ ...base, isStale: true });
    expect(stale).toContain("the latest refresh did not complete");
    const fresh = buildFootnote(base);
    expect(fresh).not.toContain("did not complete");
  });

  it("uses singular phrasing for a one-week window", () => {
    const footnote = buildFootnote({ ...base, fromWeek: 14, throughWeek: 14 });
    expect(footnote).toContain("Week 14.");
  });
});

describe("empty state copy", () => {
  it("gives settled its own honest reason", () => {
    expect(buildEmptyStateMessage("settled")).toContain("season is over");
  });

  it("gives skipped its own honest reason", () => {
    expect(buildEmptyStateMessage("skipped")).toContain("Waiting on");
  });

  it("falls back to a generic calculating message for pending, error, and null", () => {
    expect(buildEmptyStateMessage("pending")).toBe(buildEmptyStateMessage(null));
    expect(buildEmptyStateMessage("error")).toBe(buildEmptyStateMessage(null));
  });

  it("adds a quiet note only for error, never rendering raw detail text", () => {
    expect(buildEmptyStateQuietNote("error")).toBe("The latest refresh did not complete.");
    expect(buildEmptyStateQuietNote("settled")).toBeNull();
    expect(buildEmptyStateQuietNote("pending")).toBeNull();
    expect(buildEmptyStateQuietNote(null)).toBeNull();
  });
});
