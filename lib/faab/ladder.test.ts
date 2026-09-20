import { describe, it, expect } from "vitest";
import { buildLadder, upgradeStrengthOf, type LadderInput } from "./ladder";
import { DEFAULT_FAAB_SETTINGS } from "./default-settings";
import type { FaabSettings, MarginalValue, MarketRead } from "./types";

/**
 * A useful-but-not-season-changing add: +3 a week and +7 points of playoff
 * odds, both under the empty-the-clip thresholds. Dump mode deliberately
 * lifts the ceiling, so the baseline has to sit below it or every pricing
 * test would be measuring the dump path instead.
 */
function marginal(overrides: Partial<MarginalValue> = {}): MarginalValue {
  return {
    weeksConsidered: 8,
    weeksStarting: 6,
    pointsPerWeek: 3,
    pointsPerStartedWeek: 4,
    netPointsPerWeek: 3,
    expectedWinsAdded: 0.4,
    playoffOddsBefore: 45,
    playoffOddsAfter: 52,
    titleOddsBefore: 8,
    titleOddsAfter: 11,
    weeks: [],
    dropCost: null,
    dropOptions: [],
    dropNote: null,
    isBenchOnly: false,
    ...overrides,
  };
}

function market(overrides: Partial<MarketRead> = {}): MarketRead {
  return {
    yourBudget: 100,
    rivalsRicher: 3,
    rivalsAtLeastAsRich: 3,
    richestRivalBudget: 90,
    medianRivalBudget: 55,
    leagueTotalBudget: 100,
    everyoneAtFullBudget: false,
    interestedRivals: 2,
    rivalsChecked: 11,
    comparable: null,
    weeksLeft: 8,
    urgencyMultiplier: 1,
    calendarMultiplier: 1,
    aliveCount: null,
    ...overrides,
  };
}

/**
 * A stand-in for the auction model: a bid of `half` dollars wins half the
 * time, and the curve rises linearly either side of it. Deterministic, so a
 * ladder test measures the ladder and not the simulation.
 */
function linearCurve(half: number) {
  return (dollars: number) => Math.max(0, Math.min(1, dollars / (2 * half)));
}

function baseInput(overrides: Partial<LadderInput> = {}): LadderInput {
  return {
    marginal: marginal(),
    playerSignals: [],
    marketSignals: [],
    market: market(),
    remainingBudget: 100,
    totalBudget: 100,
    minBid: 0,
    needLevel: "medium",
    mode: "league",
    settings: DEFAULT_FAAB_SETTINGS,
    confidence: "high",
    goal: "value",
    winChanceAt: linearCurve(20),
    rivalTop: { p50: 20, p75: 30 },
    noRivalShare: 0,
    ...overrides,
  };
}

describe("upgradeStrengthOf", () => {
  it("is zero without a marginal value", () => {
    expect(upgradeStrengthOf(null, DEFAULT_FAAB_SETTINGS.marginal)).toBe(0);
  });

  it("blends points and playoff odds", () => {
    const pointsOnly = upgradeStrengthOf(
      marginal({ playoffOddsBefore: null, playoffOddsAfter: null }),
      DEFAULT_FAAB_SETTINGS.marginal,
    );
    const blended = upgradeStrengthOf(marginal(), DEFAULT_FAAB_SETTINGS.marginal);
    expect(pointsOnly).not.toBe(blended);
  });

  it("counts a title-odds swing when playoff value is on", () => {
    const small = upgradeStrengthOf(
      marginal({ titleOddsBefore: 8, titleOddsAfter: 8 }),
      DEFAULT_FAAB_SETTINGS.marginal,
      DEFAULT_FAAB_SETTINGS.playoffValue,
    );
    const big = upgradeStrengthOf(
      marginal({ titleOddsBefore: 8, titleOddsAfter: 20 }),
      DEFAULT_FAAB_SETTINGS.marginal,
      DEFAULT_FAAB_SETTINGS.playoffValue,
    );
    expect(big).toBeGreaterThan(small);
  });

  it("ignores title odds when that group is switched off", () => {
    const settings = structuredClone(DEFAULT_FAAB_SETTINGS);
    settings.playoffValue.enabled = false;
    const withSwing = upgradeStrengthOf(
      marginal({ titleOddsBefore: 8, titleOddsAfter: 30 }),
      settings.marginal,
      settings.playoffValue,
    );
    const without = upgradeStrengthOf(marginal(), settings.marginal, settings.playoffValue);
    expect(withSwing).toBe(without);
  });
});

describe("need level", () => {
  it("is ignored in league mode, where the roster already said how badly he is needed", () => {
    const low = buildLadder(baseInput({ needLevel: "low" }));
    const high = buildLadder(baseInput({ needLevel: "high" }));
    expect(high.ladder.walkAway.dollars).toBe(low.ladder.walkAway.dollars);
  });

  it("still moves the number in manual mode, which has no roster to read", () => {
    const low = buildLadder(baseInput({ mode: "manual", needLevel: "low" }));
    const high = buildLadder(baseInput({ mode: "manual", needLevel: "high" }));
    expect(high.ladder.walkAway.dollars).toBeGreaterThan(low.ladder.walkAway.dollars);
  });
});

describe("the two goals", () => {
  it("aims the value bid at the value target and the sure bid higher", () => {
    const out = buildLadder(baseInput());
    const value = out.ladder.bidsByGoal.value;
    const sure = out.ladder.bidsByGoal.sure;
    expect(value.winChance).not.toBeNull();
    expect(sure.dollars).toBeGreaterThan(value.dollars);
    expect(sure.winChance!).toBeGreaterThan(value.winChance!);
  });

  it("carries both answers whichever goal was asked for, so the toggle needs no server", () => {
    const asValue = buildLadder(baseInput({ goal: "value" }));
    const asSure = buildLadder(baseInput({ goal: "sure" }));
    expect(asValue.ladder.bidsByGoal).toEqual(asSure.ladder.bidsByGoal);
    expect(asValue.ladder.bid).toEqual(asValue.ladder.bidsByGoal.value);
    expect(asSure.ladder.bid).toEqual(asSure.ladder.bidsByGoal.sure);
  });

  it("never lets the value bid pass his worth", () => {
    // A room that will not stop bidding: the target is unreachable under worth.
    const out = buildLadder(baseInput({ winChanceAt: linearCurve(400) }));
    expect(out.ladder.bidsByGoal.value.dollars).toBeLessThanOrEqual(
      out.ladder.walkAway.dollars,
    );
  });

  it("lets the sure bid pass worth, but only by the stated margin", () => {
    const out = buildLadder(baseInput({ goal: "sure", winChanceAt: linearCurve(400) }));
    const cap = Math.round(
      out.ladder.walkAway.dollars *
        (1 + DEFAULT_FAAB_SETTINGS.goal.sureMaxOverWorthPct / 100),
    );
    expect(out.ladder.bid.dollars).toBeLessThanOrEqual(cap);
    expect(out.ladder.bid.dollars).toBeGreaterThan(out.ladder.walkAway.dollars);
    expect(out.explanation).toContain("over his worth to you");
  });

  it("says so when he will cost more than he is worth", () => {
    const out = buildLadder(baseInput({ winChanceAt: linearCurve(400) }));
    expect(out.ladder.priceAboveWorth).toBe(true);
    expect(out.headline).toBe("He will likely cost more than he is worth to you");
  });

  it("never inverts the two goals", () => {
    for (const half of [1, 5, 20, 60, 200]) {
      const out = buildLadder(baseInput({ winChanceAt: linearCurve(half) }));
      expect(out.ladder.bidsByGoal.sure.dollars).toBeGreaterThanOrEqual(
        out.ladder.bidsByGoal.value.dollars,
      );
    }
  });
});

describe("when nobody else wants him", () => {
  it("bids the league minimum and says why", () => {
    const out = buildLadder(
      baseInput({ noRivalShare: 1, minBid: 1, winChanceAt: () => 1 }),
    );
    expect(out.ladder.bid.dollars).toBe(1);
    expect(out.headline).toBe("Nobody else needs him");
  });

  it("bids nothing at all in a league that allows a zero bid", () => {
    const out = buildLadder(baseInput({ noRivalShare: 1, minBid: 0, winChanceAt: () => 1 }));
    expect(out.ladder.bid.dollars).toBe(0);
  });
});

describe("a bench-only player", () => {
  it("is priced at the minimum on both goals", () => {
    const out = buildLadder(
      baseInput({ marginal: marginal({ isBenchOnly: true, weeksStarting: 0 }), minBid: 1 }),
    );
    expect(out.ladder.bidsByGoal.value.dollars).toBe(1);
    expect(out.ladder.bidsByGoal.sure.dollars).toBe(1);
    expect(out.headline).toBe("Not an upgrade");
  });
});

describe("the odd-number nudge", () => {
  it("adds a dollar to a round bid, because ties go to waiver order", () => {
    // A curve that first clears 60% at exactly 20 dollars.
    const step = (dollars: number) => (dollars >= 20 ? 0.62 : 0.1);
    const out = buildLadder(baseInput({ winChanceAt: step }));
    expect(out.ladder.bidsByGoal.value.dollars).toBe(21);
  });

  it("leaves a bid that is already odd alone", () => {
    const step = (dollars: number) => (dollars >= 21 ? 0.62 : 0.1);
    const out = buildLadder(baseInput({ winChanceAt: step }));
    expect(out.ladder.bidsByGoal.value.dollars).toBe(21);
  });

  it("leaves small bids alone, where a dollar is a real share of the budget", () => {
    const step = (dollars: number) => (dollars >= 5 ? 0.62 : 0.1);
    const out = buildLadder(baseInput({ winChanceAt: step }));
    expect(out.ladder.bidsByGoal.value.dollars).toBe(5);
  });

  it("can be switched off", () => {
    const settings = structuredClone(DEFAULT_FAAB_SETTINGS);
    settings.auction.oddNudge = false;
    const step = (dollars: number) => (dollars >= 20 ? 0.62 : 0.1);
    const out = buildLadder(baseInput({ settings, winChanceAt: step }));
    expect(out.ladder.bidsByGoal.value.dollars).toBe(20);
  });
});

describe("budget arithmetic", () => {
  it("prices in shares of the FULL budget, not of what is left", () => {
    const full = buildLadder(baseInput({ totalBudget: 100, remainingBudget: 100 }));
    const spent = buildLadder(baseInput({ totalBudget: 100, remainingBudget: 40 }));
    // The same player is worth the same share; the reader simply cannot pay it.
    expect(spent.worthPct).toBe(full.worthPct);
    expect(spent.ladder.walkAway.dollars).toBeLessThanOrEqual(40);
  });

  it("scales into a thousand-dollar league", () => {
    const small = buildLadder(baseInput({ totalBudget: 100, remainingBudget: 100 }));
    const big = buildLadder(baseInput({ totalBudget: 1000, remainingBudget: 1000 }));
    expect(big.ladder.walkAway.dollars).toBeGreaterThan(small.ladder.walkAway.dollars * 5);
    expect(big.worthPct).toBeCloseTo(small.worthPct, 6);
  });

  it("never recommends more than the reader has", () => {
    const out = buildLadder(
      baseInput({ remainingBudget: 7, goal: "sure", winChanceAt: linearCurve(400) }),
    );
    expect(out.ladder.bid.dollars).toBeLessThanOrEqual(7);
    expect(out.ladder.budgetAfterBid).toBeGreaterThanOrEqual(0);
  });

  it("reports what is left after the bid", () => {
    const out = buildLadder(baseInput());
    expect(out.ladder.budgetAfterBid).toBe(100 - out.ladder.bid.dollars);
  });
});

describe("empty the clip", () => {
  it("fires on a genuine playoff-odds swing", () => {
    const out = buildLadder(
      baseInput({
        marginal: marginal({ playoffOddsBefore: 40, playoffOddsAfter: 62 }),
      }),
    );
    expect(out.isDumpCandidate).toBe(true);
    expect(out.aggressionLabel).toBe("Empty the Clip");
  });

  it("fires when four rivals would start him", () => {
    const out = buildLadder(baseInput({ interestedRivals: 4 }));
    expect(out.isDumpCandidate).toBe(true);
  });

  it("does not fire on four rivals for a player who never starts for you", () => {
    const out = buildLadder(
      baseInput({
        interestedRivals: 6,
        marginal: marginal({ weeksStarting: 0, isBenchOnly: true }),
      }),
    );
    expect(out.isDumpCandidate).toBe(false);
  });

  it("fires in superflex when one of your starting quarterbacks is out", () => {
    const out = buildLadder(baseInput({ superflexQbEmergency: true }));
    expect(out.isDumpCandidate).toBe(true);
  });

  it("refuses to tell an eliminated team to spend everything", () => {
    const out = buildLadder(
      baseInput({
        interestedRivals: 8,
        superflexQbEmergency: true,
        marginal: marginal({
          playoffOddsBefore: 3,
          playoffOddsAfter: 30,
          netPointsPerWeek: 6,
        }),
      }),
    );
    expect(out.isDumpCandidate).toBe(false);
    expect(out.notices.join(" ")).toContain("not the week to empty the budget");
  });

  /**
   * The scale this whole module runs on, pinned.
   *
   * The simulator that feeds it answers in a 0-to-1 probability and every
   * threshold here is written in percentage POINTS. When the producer handed
   * over the raw probability, a healthy 45% team arrived as 0.45, landed under
   * the 5-point already-cooked ceiling, and every reader in every league was
   * told their season was over and the empty-the-clip path was switched off
   * for all of them. These two cases fail if the scale slips again.
   */
  it("reads a 45 as forty-five percent, not as a probability", () => {
    const out = buildLadder(
      baseInput({
        marginal: marginal({
          playoffOddsBefore: 45,
          playoffOddsAfter: 68,
          netPointsPerWeek: 6,
        }),
      }),
    );
    expect(out.isDumpCandidate).toBe(true);
    expect(out.notices.join(" ")).not.toContain("not the week to empty the budget");
  });

  it("treats the already-cooked ceiling as points too", () => {
    const out = buildLadder(
      baseInput({
        interestedRivals: 0,
        marginal: marginal({
          playoffOddsBefore: 4,
          playoffOddsAfter: 40,
          netPointsPerWeek: 6,
        }),
      }),
    );
    expect(out.isDumpCandidate).toBe(false);
  });

  it("can be switched off entirely", () => {
    const settings: FaabSettings = structuredClone(DEFAULT_FAAB_SETTINGS);
    settings.leagueDump.enabled = false;
    const out = buildLadder(
      baseInput({
        settings,
        marginal: marginal({ playoffOddsBefore: 40, playoffOddsAfter: 70 }),
      }),
    );
    expect(out.isDumpCandidate).toBe(false);
  });
});

describe("without a price model at all", () => {
  it("still gives a walk-away, and no win chance", () => {
    const out = buildLadder(baseInput({ winChanceAt: null, rivalTop: null }));
    expect(out.ladder.walkAway.dollars).toBeGreaterThan(0);
    expect(out.ladder.bid.winChance).toBeNull();
    expect(out.ladder.priceAboveWorth).toBe(false);
  });
});

describe("chopped mode", () => {
  it("takes worth from the chopped model and uses its headline", () => {
    const out = buildLadder(
      baseInput({ worthPctOverride: 40, choppedHeadline: "Survive this week" }),
    );
    expect(out.worthPct).toBe(40);
    expect(out.ladder.walkAway.dollars).toBe(40);
    expect(out.headline).toBe("Survive this week");
  });
});

describe("thin data", () => {
  it("says so out loud", () => {
    const out = buildLadder(baseInput({ confidence: "low" }));
    expect(out.notices.join(" ")).toContain(DEFAULT_FAAB_SETTINGS.copy.thinDataNote);
  });
});

describe("the win curve", () => {
  it("is sampled across the budget and includes the marked bids", () => {
    const out = buildLadder(baseInput());
    const dollars = out.ladder.winCurve.map((p) => p.dollars);
    expect(out.ladder.winCurve.length).toBeGreaterThan(10);
    expect(dollars).toContain(0);
    expect(dollars).toContain(100);
    expect(dollars).toContain(out.ladder.bidsByGoal.value.dollars);
    expect(dollars).toContain(out.ladder.bidsByGoal.sure.dollars);
    expect(dollars).toContain(out.ladder.walkAway.dollars);
  });

  it("rises with the bid and never leaves 0 to 1", () => {
    const out = buildLadder(baseInput());
    let last = -1;
    for (const point of out.ladder.winCurve) {
      expect(point.winChance).toBeGreaterThanOrEqual(0);
      expect(point.winChance).toBeLessThanOrEqual(1);
      expect(point.winChance).toBeGreaterThanOrEqual(last);
      last = point.winChance;
    }
  });

  it("is sorted and free of duplicate points", () => {
    const out = buildLadder(baseInput());
    const dollars = out.ladder.winCurve.map((p) => p.dollars);
    expect([...dollars].sort((a, b) => a - b)).toEqual(dollars);
    expect(new Set(dollars).size).toBe(dollars.length);
  });

  it("is empty when nothing could price the bid, so the page can say so", () => {
    const out = buildLadder(baseInput({ winChanceAt: null }));
    expect(out.ladder.winCurve).toEqual([]);
  });

  it("is empty for a reader with no money left", () => {
    const out = buildLadder(baseInput({ remainingBudget: 0 }));
    expect(out.ladder.winCurve).toEqual([]);
  });

  it("never runs past what the reader holds", () => {
    const out = buildLadder(baseInput({ remainingBudget: 23 }));
    for (const point of out.ladder.winCurve) {
      expect(point.dollars).toBeLessThanOrEqual(23);
    }
  });
});

describe("need level and the empty-the-clip range", () => {
  /**
   * The dump range was the SECOND reader of needLevel. Removing need from
   * worthPct left this one behind, so a control the page describes as manual
   * mode only was still moving the league-mode walk-away between 75% and
   * 100% of the whole budget on any claim that tripped the dump. That is the
   * most important number on the card, moved by a control the page says does
   * nothing.
   */
  const dumping = { marginal: marginal({ playoffOddsBefore: 40, playoffOddsAfter: 70 }) };

  it("is deaf to the need control in league mode, even on a dump", () => {
    const low = buildLadder(baseInput({ ...dumping, needLevel: "low" }));
    const high = buildLadder(baseInput({ ...dumping, needLevel: "high" }));
    expect(low.isDumpCandidate).toBe(true);
    expect(high.isDumpCandidate).toBe(true);
    expect(high.ladder.walkAway.dollars).toBe(low.ladder.walkAway.dollars);
  });

  it("still listens to it in manual mode, where the reader is the only source", () => {
    const low = buildLadder(baseInput({ ...dumping, mode: "manual", needLevel: "low" }));
    const high = buildLadder(baseInput({ ...dumping, mode: "manual", needLevel: "high" }));
    expect(high.ladder.walkAway.dollars).toBeGreaterThan(low.ladder.walkAway.dollars);
  });
});

describe("worth before and after the dynasty blend", () => {
  it("reports the points-only figure separately, so the dynasty reason can be judged", () => {
    const out = buildLadder(baseInput({ dynastyValuePct: 80, dynastyBlendWeight: 0.6 }));
    expect(out.pointsWorthPct).toBeLessThan(out.worthPct);
    expect(out.worthPct).toBeGreaterThan(0);
  });

  it("leaves the two equal when no dynasty value applies", () => {
    const out = buildLadder(baseInput());
    expect(out.pointsWorthPct).toBe(out.worthPct);
  });
});

describe("player quality", () => {
  /**
   * Restored from the old suite. Player signals change what he is WORTH, not
   * what he costs, so they have to move the ceiling.
   */
  it("raises the ceiling when the signals are good", () => {
    const plain = buildLadder(baseInput());
    const strong = buildLadder(
      baseInput({
        playerSignals: [
          {
            id: "opportunity",
            label: "His role just grew",
            detail: "Test detail.",
            tone: "good",
            multiplier: 1.2,
            spread: 0,
          },
        ],
      }),
    );
    expect(strong.worthPct).toBeGreaterThan(plain.worthPct);
    expect(strong.ladder.walkAway.dollars).toBeGreaterThan(plain.ladder.walkAway.dollars);
  });
});
