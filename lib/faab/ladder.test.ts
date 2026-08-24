import { describe, it, expect } from "vitest";
import { buildLadder, upgradeStrengthOf, type LadderInput } from "./ladder";
import { DEFAULT_FAAB_SETTINGS } from "./default-settings";
import type { FaabSettings, MarginalValue, MarketRead } from "./types";

/**
 * A useful-but-not-season-changing add: +3 a week and +7 points of playoff
 * odds, both under the empty-the-clip thresholds. Dump mode deliberately
 * bypasses market pricing and league history, so the baseline has to sit below
 * it or every pricing test would be measuring the dump path instead.
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
    ...overrides,
  };
}

function baseInput(overrides: Partial<LadderInput> = {}): LadderInput {
  return {
    marginal: marginal(),
    playerSignals: [],
    marketSignals: [],
    market: market(),
    remainingBudget: 100,
    needLevel: "medium",
    settings: DEFAULT_FAAB_SETTINGS,
    confidence: "high",
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
    expect(pointsOnly).toBeGreaterThan(0);
    expect(blended).toBeGreaterThan(0);
    expect(blended).not.toBeCloseTo(pointsOnly, 5);
  });
});

describe("the ladder", () => {
  it("orders the rungs so the recommendation never exceeds the walk-away", () => {
    const out = buildLadder(baseInput());
    expect(out.ladder.likely).toBeLessThanOrEqual(out.ladder.aggressive);
    expect(out.ladder.aggressive).toBeLessThanOrEqual(out.ladder.walkAway);
  });

  it("never recommends more than the remaining budget", () => {
    const out = buildLadder(
      baseInput({
        remainingBudget: 7,
        marginal: marginal({ netPointsPerWeek: 12, playoffOddsAfter: 95 }),
      }),
    );
    expect(out.ladder.walkAway).toBeLessThanOrEqual(7);
    expect(out.ladder.likely).toBeLessThanOrEqual(7);
  });

  it("prices a bench-only player at nothing rather than inventing a bid", () => {
    const out = buildLadder(
      baseInput({
        marginal: marginal({
          isBenchOnly: true,
          weeksStarting: 0,
          netPointsPerWeek: 0,
          pointsPerWeek: 0,
          playoffOddsBefore: 45,
          playoffOddsAfter: 45,
        }),
      }),
    );
    expect(out.ladder.likely).toBe(0);
    expect(out.headline).toBe("Not an upgrade");
  });

  it("gives a starter at least the minimum bid", () => {
    const out = buildLadder(
      baseInput({
        marginal: marginal({
          netPointsPerWeek: 0.05,
          weeksStarting: 1,
          playoffOddsBefore: 40,
          playoffOddsAfter: 40,
        }),
      }),
    );
    expect(out.ladder.likely).toBeGreaterThanOrEqual(
      DEFAULT_FAAB_SETTINGS.ladder.minStartableBid,
    );
  });

  it("market pressure changes the price but never the walk-away ceiling", () => {
    // The walk-away is VALUE. A rich rival makes the player cost more, it does
    // not make him worth more, and confusing the two is how managers overpay.
    const cheap = buildLadder(
      baseInput({
        marketSignals: [
          { id: "rival-budget", label: "", detail: "", tone: "good", multiplier: 0.8, spread: 0 },
        ],
      }),
    );
    const pricey = buildLadder(
      baseInput({
        marketSignals: [
          { id: "rival-budget", label: "", detail: "", tone: "bad", multiplier: 1.2, spread: 0 },
        ],
      }),
    );
    expect(cheap.ladder.walkAway).toBe(pricey.ladder.walkAway);
    expect(cheap.ladder.likely).toBeLessThan(pricey.ladder.likely);
  });

  it("player quality raises the ceiling, because it changes what he is worth", () => {
    const plain = buildLadder(baseInput());
    const strong = buildLadder(
      baseInput({
        playerSignals: [
          { id: "opportunity", label: "", detail: "", tone: "good", multiplier: 1.2, spread: 0 },
        ],
      }),
    );
    expect(strong.ladder.walkAway).toBeGreaterThan(plain.ladder.walkAway);
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
    expect(out.headline).toBe("Empty the clip");
  });

  it("refuses to tell an eliminated team to spend everything", () => {
    // A 3% playoff chance is not one waiver claim away, and this is the single
    // worst piece of advice the tool could give.
    const out = buildLadder(
      baseInput({
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
   * told their season was over and the empty-the-clip path was switched off for
   * all of them. These two cases fail if the scale slips again.
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

describe("league price history", () => {
  it("pulls the recommendation toward what the league actually pays", () => {
    const withoutHistory = buildLadder(baseInput());
    const withHistory = buildLadder(
      baseInput({
        market: market({
          comparable: {
            sampleSize: 30,
            median: 4,
            p25: 2,
            p75: 7,
            seasonsCovered: [2025, 2026],
          },
        }),
      }),
    );
    // This is a cheap room. The recommendation must come down toward it.
    expect(withHistory.ladder.likely).toBeLessThan(withoutHistory.ladder.likely);
  });
});

describe("thin data", () => {
  it("says so out loud", () => {
    const out = buildLadder(baseInput({ confidence: "low" }));
    expect(out.notices.join(" ")).toContain(DEFAULT_FAAB_SETTINGS.copy.thinDataNote);
  });
});
