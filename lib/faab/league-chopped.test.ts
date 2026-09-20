import { describe, expect, it } from "vitest";

import { DEFAULT_FAAB_SETTINGS } from "./default-settings";
import {
  aliveRosterIds,
  choppedStrength,
  computeChopped,
  dangerBoost,
  paceFor,
  priceByAliveFraction,
  type ChoppedContext,
} from "./league-chopped";

const CHOPPED = DEFAULT_FAAB_SETTINGS.chopped;

describe("priceByAliveFraction", () => {
  it("pays full price while half the field is alive", () => {
    expect(priceByAliveFraction(1, CHOPPED)).toBe(1);
    expect(priceByAliveFraction(0.5, CHOPPED)).toBe(1);
  });

  it("falls hard as the field thins, which is what the published prices do", () => {
    expect(priceByAliveFraction(0.4, CHOPPED)).toBeLessThan(priceByAliveFraction(0.6, CHOPPED));
    expect(priceByAliveFraction(0.2, CHOPPED)).toBeLessThan(priceByAliveFraction(0.4, CHOPPED));
  });

  it("covers a league down to its last team", () => {
    expect(priceByAliveFraction(0, CHOPPED)).toBeGreaterThan(0);
  });
});

describe("paceFor", () => {
  it("calls a manager holding the target amount on pace", () => {
    expect(paceFor(4, 90, CHOPPED).status).toBe("on-pace");
  });

  it("calls a big spender behind", () => {
    const pace = paceFor(4, 40, CHOPPED);
    expect(pace.status).toBe("behind");
    expect(pace.targetHoldPct).toBe(90);
  });

  it("calls a hoarder ahead", () => {
    expect(paceFor(12, 80, CHOPPED).status).toBe("ahead");
  });

  it("uses the last target past the end of the season", () => {
    expect(paceFor(18, 0, CHOPPED).targetHoldPct).toBe(0);
  });
});

describe("choppedStrength", () => {
  const flat = { pChoppedThisWeek: 0.2, pWin: 0.1, expectedWeeksAlive: 5 };

  it("is zero when nothing changes", () => {
    expect(choppedStrength(flat, flat, CHOPPED)).toBe(0);
  });

  it("rises when the signing cuts the chance of being chopped", () => {
    const after = { ...flat, pChoppedThisWeek: 0.08 };
    expect(choppedStrength(flat, after, CHOPPED)).toBeGreaterThan(0);
  });

  it("counts winning the league as well as surviving the week", () => {
    const survives = choppedStrength(flat, { ...flat, pChoppedThisWeek: 0.1 }, CHOPPED);
    const both = choppedStrength(
      flat,
      { pChoppedThisWeek: 0.1, pWin: 0.2, expectedWeeksAlive: 5 },
      CHOPPED,
    );
    expect(both).toBeGreaterThan(survives);
  });

  it("counts the extra weeks a real upgrade buys a safe team", () => {
    const safe = { pChoppedThisWeek: 0.01, pWin: 0.2, expectedWeeksAlive: 6 };
    const better = { pChoppedThisWeek: 0.01, pWin: 0.2, expectedWeeksAlive: 7.5 };
    expect(choppedStrength(safe, better, CHOPPED)).toBeGreaterThan(0);
  });

  it("never exceeds 1, however dramatic the swing", () => {
    const after = { pChoppedThisWeek: 0, pWin: 0.9, expectedWeeksAlive: 17 };
    expect(choppedStrength(flat, after, CHOPPED)).toBeLessThanOrEqual(1);
  });

  it("never goes negative when the signing makes things worse", () => {
    const worse = { pChoppedThisWeek: 0.5, pWin: 0.01, expectedWeeksAlive: 3 };
    expect(choppedStrength(flat, worse, CHOPPED)).toBe(0);
  });
});

describe("dangerBoost", () => {
  it("leaves a safe team bidding normally", () => {
    expect(dangerBoost(0, 0.4, CHOPPED)).toBe(1);
  });

  it("makes the team closest to the trapdoor bid hardest", () => {
    expect(dangerBoost(0.4, 0.4, CHOPPED)).toBeGreaterThan(dangerBoost(0.2, 0.4, CHOPPED));
  });

  it("is neutral when nobody is in danger at all", () => {
    expect(dangerBoost(0, 0, CHOPPED)).toBe(1);
  });
});

describe("aliveRosterIds", () => {
  it("keeps the teams still playing and drops the chopped ones", () => {
    const rosters = [
      { sleeperRosterId: 1, metadata: { settings: { eliminated: 0 } } },
      { sleeperRosterId: 2, metadata: { settings: {} } },
      { sleeperRosterId: 3, metadata: { settings: { eliminated: 4 } } },
      { sleeperRosterId: 4, metadata: {} },
    ];
    expect(aliveRosterIds(rosters)).toEqual([1, 2, 4]);
  });
});

function weeksFor(mean: number, sigma = 20): Map<number, { mean: number; sigma: number }> {
  const out = new Map<number, { mean: number; sigma: number }>();
  for (let w = 5; w <= 10; w += 1) out.set(w, { mean, sigma });
  return out;
}

function context(over: Partial<ChoppedContext> = {}): ChoppedContext {
  const weeklyByRoster = new Map<number, Map<number, { mean: number; sigma: number }>>();
  weeklyByRoster.set(1, weeksFor(100));
  weeklyByRoster.set(2, weeksFor(105));
  weeklyByRoster.set(3, weeksFor(110));
  weeklyByRoster.set(4, weeksFor(95));
  return {
    aliveRosterIds: [1, 2, 3, 4],
    startCount: 8,
    currentWeek: 5,
    weeklyByRoster,
    weeklyAfter: weeksFor(115),
    seasonPointsByRoster: new Map([
      [1, 400],
      [2, 420],
      [3, 440],
      [4, 380],
    ]),
    myRosterId: 1,
    budgetByRoster: new Map([
      [1, 600],
      [2, 300],
      [3, 900],
      [4, 100],
    ]),
    totalBudget: 1000,
    substitutes: 0,
    releaseCutoffWeek: null,
    seed: 7,
    ...over,
  };
}

describe("computeChopped", () => {
  it("prices an upgrade above nothing and reports both sides of the swing", () => {
    const out = computeChopped(context(), DEFAULT_FAAB_SETTINGS, 1);
    expect(out.worthPct).toBeGreaterThan(0);
    expect(out.read.after.pChoppedThisWeek).toBeLessThan(out.read.before.pChoppedThisWeek);
  });

  it("is deterministic, so a reload does not move the number", () => {
    const a = computeChopped(context(), DEFAULT_FAAB_SETTINGS, 1);
    const b = computeChopped(context(), DEFAULT_FAAB_SETTINGS, 1);
    expect(a.worthPct).toBe(b.worthPct);
    expect(a.read.before.pChoppedThisWeek).toBe(b.read.before.pChoppedThisWeek);
  });

  it("counts only the money alive teams hold", () => {
    const out = computeChopped(context(), DEFAULT_FAAB_SETTINGS, 1);
    expect(out.read.moneyLeftInLeague).toBe(1900);
    expect(out.read.yourShareOfMoney).toBeCloseTo(600 / 1900, 6);
    expect(out.read.yourMoneyRank).toBe(2);
  });

  it("ranks the reader's own danger against the rest of the field", () => {
    const out = computeChopped(context(), DEFAULT_FAAB_SETTINGS, 1);
    expect(out.read.dangerRank).toBeGreaterThanOrEqual(1);
    expect(out.read.dangerRank).toBeLessThanOrEqual(4);
  });

  it("flips the default goal to making sure when the reader is in real danger", () => {
    const weak = new Map<number, Map<number, { mean: number; sigma: number }>>();
    weak.set(1, weeksFor(70));
    weak.set(2, weeksFor(120));
    weak.set(3, weeksFor(125));
    weak.set(4, weeksFor(130));
    const out = computeChopped(
      context({ weeklyByRoster: weak, weeklyAfter: weeksFor(80) }),
      DEFAULT_FAAB_SETTINGS,
      1,
    );
    expect(out.read.before.pChoppedThisWeek).toBeGreaterThan(CHOPPED.dangerThreshold);
    expect(out.goalDefault).toBe("sure");
  });

  it("leaves a safe reader on the value goal", () => {
    const strong = new Map<number, Map<number, { mean: number; sigma: number }>>();
    strong.set(1, weeksFor(160));
    strong.set(2, weeksFor(90));
    strong.set(3, weeksFor(88));
    strong.set(4, weeksFor(86));
    const out = computeChopped(
      context({ weeklyByRoster: strong, weeklyAfter: weeksFor(165) }),
      DEFAULT_FAAB_SETTINGS,
      1,
    );
    expect(out.goalDefault).toBe("value");
  });

  it("softens rival participation when substitutes are on the wire", () => {
    const none = computeChopped(context({ substitutes: 0 }), DEFAULT_FAAB_SETTINGS, 1);
    const several = computeChopped(context({ substitutes: 3 }), DEFAULT_FAAB_SETTINGS, 1);
    expect(several.participationScale).toBeLessThan(none.participationScale);
    expect(none.participationScale).toBe(1);
  });

  it("charges less for the same player as the field shrinks", () => {
    const early = computeChopped(
      context({ startCount: 8, aliveRosterIds: [1, 2, 3, 4] }),
      DEFAULT_FAAB_SETTINGS,
      1,
    );
    const late = computeChopped(
      context({ startCount: 18, aliveRosterIds: [1, 2, 3, 4] }),
      DEFAULT_FAAB_SETTINGS,
      1,
    );
    expect(late.worthPct).toBeLessThan(early.worthPct);
  });

  it("says out loud that the final week is inferred rather than read", () => {
    const out = computeChopped(context(), DEFAULT_FAAB_SETTINGS, 1);
    expect(out.read.finalWeekVerified).toBe(false);
    expect(out.read.finalWeek).toBeGreaterThanOrEqual(out.read.currentWeek);
  });

  it("carries the release cutoff through for the copy to use", () => {
    const out = computeChopped(context({ releaseCutoffWeek: 14 }), DEFAULT_FAAB_SETTINGS, 1);
    expect(out.read.releaseCutoffWeek).toBe(14);
  });

  it("does not throw on a league down to one team", () => {
    const out = computeChopped(
      context({ aliveRosterIds: [1], myRosterId: 1 }),
      DEFAULT_FAAB_SETTINGS,
      1,
    );
    expect(out.read.aliveCount).toBe(1);
    expect(Number.isFinite(out.worthPct)).toBe(true);
  });
});
