import { describe, it, expect } from "vitest";
import { buildTradeOutcome, EVEN_MARGIN_PCT } from "./outcome";
import type { ImpactGaps, ResolvedAsset, TeamImpact } from "./types";

/**
 * The call is the largest thing on the page, so it is the thing most worth
 * pinning. Every case below is a shape a real league produces.
 */

const NO_GAPS: ImpactGaps = { lineup: false, simulation: false, picks: false };

function playerAsset(value: number, playerId = "p1"): ResolvedAsset {
  return {
    kind: "player",
    playerId,
    sleeperId: "1",
    name: "Somebody",
    position: "WR",
    team: "BUF",
    value,
    age: 25,
    projPoints: 12,
    isInactive: false,
  };
}

function team(overrides: Partial<TeamImpact> = {}): TeamImpact {
  return {
    rosterId: 1,
    teamName: "My Team",
    statusKey: null,
    statusLabel: null,
    pulseRank: null,
    valueBefore: 20000,
    valueAfter: 20000,
    valueDelta: 0,
    ageDelta: null,
    pickCountDelta: 0,
    lineupBefore: 100,
    lineupAfter: 100,
    lineupDelta: 0,
    weeks: [],
    weeksImproved: 0,
    weeksWorsened: 0,
    incomingStartWeeks: {},
    projectedWinsBefore: 6,
    projectedWinsAfter: 6,
    playoffOddsBefore: 0.5,
    playoffOddsAfter: 0.5,
    titleOddsBefore: 0.1,
    titleOddsAfter: 0.1,
    positionBefore: {},
    positionAfter: {},
    incoming: [],
    outgoing: [],
    ...overrides,
  };
}

describe("value balance", () => {
  it("splits the bar by each side's share of the combined package", () => {
    const o = buildTradeOutcome(
      team({ incoming: [playerAsset(6000)], outgoing: [playerAsset(4000, "p2")] }),
      NO_GAPS,
    );
    expect(o.yourShare).toBeCloseTo(60, 5);
    expect(o.theirShare).toBeCloseTo(40, 5);
    expect(o.valueMarginPct).toBeCloseTo(20, 5);
  });

  it("uses Signal Check's margin definition so the two tools cannot disagree", () => {
    // Signal Check's own test: 100 against 50 is 33.3 percent, |A-B| / (A+B).
    const o = buildTradeOutcome(
      team({ incoming: [playerAsset(100)], outgoing: [playerAsset(50, "p2")] }),
      NO_GAPS,
    );
    expect(Number(o.valueMarginPct.toFixed(1))).toBe(33.3);
  });

  it("calls a thin margin even rather than picking a winner", () => {
    const o = buildTradeOutcome(
      team({ incoming: [playerAsset(5050)], outgoing: [playerAsset(5000, "p2")] }),
      NO_GAPS,
    );
    expect(o.valueMarginPct).toBeLessThan(EVEN_MARGIN_PCT);
    expect(o.valueFavours).toBe("even");
  });

  it("splits an empty package evenly instead of dividing by zero", () => {
    const o = buildTradeOutcome(team(), NO_GAPS);
    expect(o.yourShare).toBe(50);
    expect(o.valueFavours).toBe("even");
    expect(Number.isFinite(o.valueMarginPct)).toBe(true);
  });

  it("flags a lopsided deal", () => {
    const o = buildTradeOutcome(
      team({ incoming: [playerAsset(9000)], outgoing: [playerAsset(1000, "p2")] }),
      NO_GAPS,
    );
    expect(o.lopsided).toBe(true);
  });
});

describe("the call when both measures agree", () => {
  const winning = {
    incoming: [playerAsset(7000)],
    outgoing: [playerAsset(3000, "p2")],
    projectedWinsBefore: 6,
    projectedWinsAfter: 7,
    playoffOddsBefore: 0.5,
    playoffOddsAfter: 0.65,
    lineupDelta: 4,
  };

  it("says take it when value and wins both point your way", () => {
    const o = buildTradeOutcome(team(winning), NO_GAPS);
    expect(o.call).toBe("take");
    expect(o.headline).toBe("Take this trade");
    expect(o.split).toBe(false);
  });

  it("says turn it down when both point the other way", () => {
    const o = buildTradeOutcome(
      team({
        incoming: [playerAsset(3000)],
        outgoing: [playerAsset(7000, "p2")],
        projectedWinsAfter: 5,
        playoffOddsAfter: 0.35,
        lineupDelta: -4,
      }),
      NO_GAPS,
    );
    expect(o.call).toBe("decline");
  });

  it("says too close when nothing moved", () => {
    const o = buildTradeOutcome(
      team({ incoming: [playerAsset(5000)], outgoing: [playerAsset(5000, "p2")] }),
      NO_GAPS,
    );
    expect(o.call).toBe("close");
    expect(o.split).toBe(false);
  });
});

describe("the call when one measure is quiet", () => {
  it("leans on the one that spoke, and only to a lean", () => {
    const o = buildTradeOutcome(
      team({
        // Level on value.
        incoming: [playerAsset(5000)],
        outgoing: [playerAsset(5000, "p2")],
        projectedWinsAfter: 7,
        playoffOddsAfter: 0.62,
        lineupDelta: 3,
      }),
      NO_GAPS,
    );
    expect(o.valueFavours).toBe("even");
    expect(o.call).toBe("lean-yes");
    expect(o.split).toBe(false);
  });
});

describe("the split, which is the whole point of the module", () => {
  const splitDeal = {
    // Value your way, wins the other. The rebuild trade.
    incoming: [playerAsset(8000)],
    outgoing: [playerAsset(4000, "p2")],
    projectedWinsBefore: 6,
    projectedWinsAfter: 5,
    playoffOddsBefore: 0.5,
    playoffOddsAfter: 0.38,
    lineupDelta: -3,
  };

  it("is reported as a split", () => {
    const o = buildTradeOutcome(team(splitDeal), NO_GAPS);
    expect(o.split).toBe(true);
    expect(o.valueFavours).toBe("you");
    expect(o.winsFavours).toBe("them");
  });

  it("breaks toward value for a rebuilder", () => {
    const o = buildTradeOutcome(team({ ...splitDeal, statusKey: "rebuilder" }), NO_GAPS);
    expect(o.call).toBe("lean-yes");
    expect(o.summary).toContain("not winning now");
  });

  it("breaks toward the lineup for a contender", () => {
    const o = buildTradeOutcome(team({ ...splitDeal, statusKey: "competitor" }), NO_GAPS);
    expect(o.call).toBe("lean-no");
    expect(o.summary).toContain("built to win now");
  });

  it("refuses to break the tie for a team in the middle", () => {
    // The status classifier declined to say which way this team points, so
    // inventing a direction here would be a claim the rest of the page does not
    // make.
    const o = buildTradeOutcome(team({ ...splitDeal, statusKey: "middle" }), NO_GAPS);
    expect(o.call).toBe("close");
    expect(o.split).toBe(true);
  });

  it("refuses to break the tie when there is no status at all", () => {
    const o = buildTradeOutcome(team({ ...splitDeal, statusKey: null }), NO_GAPS);
    expect(o.call).toBe("close");
  });
});

describe("what it does when a measure is missing", () => {
  it("falls back to the lineup when there is no season to simulate", () => {
    const o = buildTradeOutcome(
      team({
        incoming: [playerAsset(5000)],
        outgoing: [playerAsset(5000, "p2")],
        lineupDelta: 3,
      }),
      { lineup: false, simulation: true, picks: false },
    );
    expect(o.winsDelta).toBeNull();
    expect(o.playoffDeltaPp).toBeNull();
    expect(o.winsFavours).toBe("you");
    expect(o.call).toBe("lean-yes");
  });

  it("answers on value alone when nothing about the season is measurable", () => {
    const o = buildTradeOutcome(
      team({ incoming: [playerAsset(8000)], outgoing: [playerAsset(4000, "p2")] }),
      { lineup: true, simulation: true, picks: false },
    );
    expect(o.winsFavours).toBeNull();
    expect(o.call).toBe("lean-yes");
    expect(o.summary).toContain("no season left to measure");
  });

  it("never promotes a value-only answer to a full take", () => {
    // Half the evidence can only earn half the verdict.
    const o = buildTradeOutcome(
      team({ incoming: [playerAsset(9000)], outgoing: [playerAsset(1000, "p2")] }),
      { lineup: true, simulation: true, picks: false },
    );
    expect(o.call).toBe("lean-yes");
    expect(o.call).not.toBe("take");
  });

  it("tells a measured no-change apart from an unmeasurable one", () => {
    const measured = buildTradeOutcome(
      team({ incoming: [playerAsset(5000)], outgoing: [playerAsset(5000, "p2")] }),
      NO_GAPS,
    );
    expect(measured.winsFavours).toBe("even");
    const unmeasured = buildTradeOutcome(
      team({ incoming: [playerAsset(5000)], outgoing: [playerAsset(5000, "p2")] }),
      { lineup: true, simulation: true, picks: false },
    );
    expect(unmeasured.winsFavours).toBeNull();
  });
});

describe("the summary sentence", () => {
  it("names a figure the reader can check against the page", () => {
    const o = buildTradeOutcome(
      team({
        incoming: [playerAsset(7000)],
        outgoing: [playerAsset(3000, "p2")],
        projectedWinsAfter: 7,
        playoffOddsAfter: 0.65,
        lineupDelta: 4,
      }),
      NO_GAPS,
    );
    expect(o.summary).toContain("40% ahead on value");
    expect(o.summary).toContain("+1.0 projected wins");
  });

  it("says plainly when you are the one giving up value", () => {
    const o = buildTradeOutcome(
      team({ incoming: [playerAsset(3000)], outgoing: [playerAsset(7000, "p2")] }),
      NO_GAPS,
    );
    expect(o.summary).toContain("give up 40% more value");
  });
});
