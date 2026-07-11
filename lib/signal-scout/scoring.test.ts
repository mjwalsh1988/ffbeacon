import { describe, it, expect } from "vitest";
import {
  tierCost,
  evaluateHintPurchase,
  applyWrongGuess,
  resolveCorrectGuess,
  maxTheoreticalSpend,
  type SignalTierKey,
} from "./scoring";
import { DEFAULT_SIGNAL_SCOUT_SETTINGS } from "./default-settings";

const scoring = DEFAULT_SIGNAL_SCOUT_SETTINGS.scoring;
const tierLimits = DEFAULT_SIGNAL_SCOUT_SETTINGS.clues.tier_limits;

function baseHintInput(overrides: Partial<Parameters<typeof evaluateHintPurchase>[0]> = {}) {
  return {
    scoreAvailable: 1000,
    tier: "weak" as SignalTierKey,
    scoring,
    tierLimits,
    purchasesUsedInTier: 0,
    unrevealedInTier: 4,
    confirmBurn: false,
    ...overrides,
  };
}

describe("tierCost", () => {
  it("maps every tier to its configured cost", () => {
    expect(tierCost(scoring, "weak")).toBe(100);
    expect(tierCost(scoring, "clear")).toBe(200);
    expect(tierCost(scoring, "ping")).toBe(350);
    expect(tierCost(scoring, "scan")).toBe(500);
  });
});

describe("evaluateHintPurchase", () => {
  it("deducts cost from score on a normal purchase", () => {
    const res = evaluateHintPurchase(baseHintInput({ scoreAvailable: 1000, tier: "weak" }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.cost).toBe(100);
      expect(res.newScore).toBe(900);
      expect(res.burned).toBe(false);
    }
  });

  it("clamps at 0 and does not go negative", () => {
    const res = evaluateHintPurchase(
      baseHintInput({ scoreAvailable: 50, tier: "scan", confirmBurn: true, unrevealedInTier: 1 }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.cost).toBe(500);
      expect(res.newScore).toBe(0);
      expect(res.burned).toBe(true);
    }
  });

  it("burn boundary: cost exactly equal to score requires confirmBurn and burns", () => {
    const withoutConfirm = evaluateHintPurchase(
      baseHintInput({ scoreAvailable: 100, tier: "weak", confirmBurn: false }),
    );
    expect(withoutConfirm).toEqual({ ok: false, code: "burn_confirmation_required" });

    const withConfirm = evaluateHintPurchase(
      baseHintInput({ scoreAvailable: 100, tier: "weak", confirmBurn: true }),
    );
    expect(withConfirm.ok).toBe(true);
    if (withConfirm.ok) {
      expect(withConfirm.newScore).toBe(0);
      expect(withConfirm.burned).toBe(true);
    }
  });

  it("cost greater than score with confirmBurn clamps to 0 and burns", () => {
    const res = evaluateHintPurchase(
      baseHintInput({ scoreAvailable: 60, tier: "weak", confirmBurn: true }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.newScore).toBe(0);
      expect(res.burned).toBe(true);
    }
  });

  it("cost greater than score without confirmBurn requires confirmation", () => {
    const res = evaluateHintPurchase(
      baseHintInput({ scoreAvailable: 60, tier: "weak", confirmBurn: false }),
    );
    expect(res).toEqual({ ok: false, code: "burn_confirmation_required" });
  });

  it("purchase at score 0 is rejected as signal_burned regardless of confirmBurn", () => {
    const withoutConfirm = evaluateHintPurchase(
      baseHintInput({ scoreAvailable: 0, confirmBurn: false }),
    );
    expect(withoutConfirm).toEqual({ ok: false, code: "signal_burned" });

    const withConfirm = evaluateHintPurchase(
      baseHintInput({ scoreAvailable: 0, confirmBurn: true }),
    );
    expect(withConfirm).toEqual({ ok: false, code: "signal_burned" });
  });

  it("rejects when the tier purchase limit is reached", () => {
    const res = evaluateHintPurchase(
      baseHintInput({ tier: "scan", purchasesUsedInTier: 1 }), // scan limit is 1
    );
    expect(res).toEqual({ ok: false, code: "tier_limit_reached" });
  });

  it("rejects when no unrevealed clue remains in the tier", () => {
    const res = evaluateHintPurchase(baseHintInput({ unrevealedInTier: 0 }));
    expect(res).toEqual({ ok: false, code: "tier_exhausted" });
  });

  it("checks tier_limit_reached before tier_exhausted when both would fire", () => {
    const res = evaluateHintPurchase(
      baseHintInput({
        tier: "scan",
        purchasesUsedInTier: 1, // at scan's limit of 1
        unrevealedInTier: 0, // also exhausted
      }),
    );
    expect(res).toEqual({ ok: false, code: "tier_limit_reached" });
  });

  it("checks tier_limit_reached before the burn confirmation check", () => {
    const res = evaluateHintPurchase(
      baseHintInput({
        tier: "scan",
        purchasesUsedInTier: 1, // at scan's limit of 1
        unrevealedInTier: 1,
        scoreAvailable: 10, // cost (500) >> score, would need confirmBurn
        confirmBurn: false,
      }),
    );
    expect(res).toEqual({ ok: false, code: "tier_limit_reached" });
  });

  it("checks tier_exhausted before the burn confirmation check", () => {
    const res = evaluateHintPurchase(
      baseHintInput({
        tier: "scan",
        purchasesUsedInTier: 0,
        unrevealedInTier: 0, // exhausted
        scoreAvailable: 10, // cost (500) >> score, would need confirmBurn
        confirmBurn: false,
      }),
    );
    expect(res).toEqual({ ok: false, code: "tier_exhausted" });
  });

  it("checks signal_burned before tier_limit_reached and tier_exhausted", () => {
    const res = evaluateHintPurchase(
      baseHintInput({
        scoreAvailable: 0,
        tier: "scan",
        purchasesUsedInTier: 1, // also at limit
        unrevealedInTier: 0, // also exhausted
      }),
    );
    expect(res).toEqual({ ok: false, code: "signal_burned" });
  });

  it("does not require confirmation when cost is comfortably under score", () => {
    const res = evaluateHintPurchase(
      baseHintInput({ scoreAvailable: 1000, tier: "clear", confirmBurn: false }),
    );
    expect(res.ok).toBe(true);
  });
});

describe("applyWrongGuess", () => {
  it("deducts the wrong-guess penalty and increments the counter", () => {
    const res = applyWrongGuess({ scoreAvailable: 1000, wrongGuessCount: 0, scoring });
    expect(res.newScore).toBe(900);
    expect(res.newWrongGuessCount).toBe(1);
    expect(res.burned).toBe(false);
    expect(res.failed).toBe(false);
  });

  it("drains score to 0 and sets burned when penalty exceeds remaining score", () => {
    const res = applyWrongGuess({ scoreAvailable: 40, wrongGuessCount: 1, scoring });
    expect(res.newScore).toBe(0);
    expect(res.burned).toBe(true);
  });

  it("never deducts below 0", () => {
    const res = applyWrongGuess({ scoreAvailable: 0, wrongGuessCount: 2, scoring });
    expect(res.newScore).toBe(0);
    expect(res.burned).toBe(true);
  });

  it("sets failed true on the third wrong guess, even at score 0", () => {
    const res = applyWrongGuess({ scoreAvailable: 0, wrongGuessCount: 2, scoring });
    expect(res.newWrongGuessCount).toBe(3);
    expect(res.failed).toBe(true);
  });

  it("does not set failed before reaching max_wrong_guesses", () => {
    const first = applyWrongGuess({ scoreAvailable: 1000, wrongGuessCount: 0, scoring });
    expect(first.failed).toBe(false);
    const second = applyWrongGuess({ scoreAvailable: 900, wrongGuessCount: 1, scoring });
    expect(second.failed).toBe(false);
  });
});

describe("resolveCorrectGuess", () => {
  it("awards the full remaining score and wins with 1000 available", () => {
    expect(resolveCorrectGuess(1000)).toEqual({ outcome: "won", scoreAwarded: 1000 });
  });

  it("wins and awards exactly the remaining score with no minimum floor (score of 1)", () => {
    expect(resolveCorrectGuess(1)).toEqual({ outcome: "won", scoreAwarded: 1 });
  });

  it("resolves as solved_late with 0 points at score 0", () => {
    expect(resolveCorrectGuess(0)).toEqual({ outcome: "solved_late", scoreAwarded: 0 });
  });
});

describe("maxTheoreticalSpend", () => {
  it("equals 2200 with the shipped default settings", () => {
    expect(maxTheoreticalSpend(scoring, tierLimits)).toBe(2200);
  });

  it("sums cost times limit per tier for arbitrary settings", () => {
    const customScoring = { ...scoring, weak_signal_cost: 10, clear_signal_cost: 20, beacon_ping_cost: 30, full_scan_cost: 40 };
    const customLimits = { weak: 1, clear: 2, ping: 3, scan: 4 };
    // 10*1 + 20*2 + 30*3 + 40*4 = 10 + 40 + 90 + 160 = 300
    expect(maxTheoreticalSpend(customScoring, customLimits)).toBe(300);
  });
});
