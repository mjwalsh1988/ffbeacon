/**
 * Dead-signal scoring model for Signal Scout (plan section 5, decisions 8-12,
 * hint reveal sequence in plan section 13).
 *
 * Pure functions only: no I/O, no Date, no randomness. Every function takes
 * plain values (plus the admin-editable ScoringSettings / ClueTierLimits) and
 * returns plain values, so the game's money-math is trivially unit-testable
 * and reusable from both the API routes and any future simulation tooling.
 *
 * Model summary:
 *   - Score starts at scoring.starting_score and only ever goes down. It
 *     clamps at 0 and never goes negative. There is deliberately no minimum
 *     floor (the old 100-point floor was removed, decision 8).
 *   - Hints cost score; a hint whose cost meets or exceeds the available
 *     score can still be bought, but only with an explicit confirmBurn flag
 *     (decision 10). Buying at score 0 is rejected outright.
 *   - Wrong guesses cost a flat penalty and count toward a 3-strike fail cap,
 *     even once score has already hit 0 (burning out does not end the round,
 *     decision 11).
 *   - A correct guess awards whatever score remains: 1+ points is a win,
 *     exactly 0 is "solved too late" and awards nothing.
 */

import type { ClueTierLimits, ScoringSettings } from "./types";

/** Signal reveal tiers, cheapest to most expensive. Mirrors SignalTier in
 * types.ts; kept as its own alias here so this module's public surface is
 * self-describing for consumers that only need the scoring API. */
export type SignalTierKey = "weak" | "clear" | "ping" | "scan";

/**
 * Typed error codes for a rejected hint purchase, in the exact order the
 * hint reveal API checks them (plan section 13):
 *   1. signal_burned            - score is already 0
 *   2. tier_disabled            - tier or its clue keys are admin-disabled
 *   3. tier_limit_reached       - per-round purchase cap hit for this tier
 *   4. tier_exhausted           - no unrevealed clue left in this tier
 *   5. burn_confirmation_required - cost >= score and confirmBurn was not set
 *
 * NOTE: tier_disabled is never produced by evaluateHintPurchase below. It
 * depends on admin config (disabled_clue_keys, per-clue not per-tier) that
 * this pure aggregate function is never handed. The caller (the hint route
 * / round engine) is responsible for the tier_disabled check before it ever
 * calls evaluateHintPurchase; the code lives here only so every layer shares
 * one HintErrorCode union.
 */
export type HintErrorCode =
  | "signal_burned"
  | "tier_disabled"
  | "tier_limit_reached"
  | "tier_exhausted"
  | "burn_confirmation_required";

function clamp0(n: number): number {
  return Math.max(0, n);
}

/** Maps a signal tier to its configured cost. */
export function tierCost(scoring: ScoringSettings, tier: SignalTierKey): number {
  switch (tier) {
    case "weak":
      return scoring.weak_signal_cost;
    case "clear":
      return scoring.clear_signal_cost;
    case "ping":
      return scoring.beacon_ping_cost;
    case "scan":
      return scoring.full_scan_cost;
  }
}

/** Maps a signal tier to its configured per-round purchase limit. */
function tierLimit(tierLimits: ClueTierLimits, tier: SignalTierKey): number {
  return tierLimits[tier];
}

export interface HintPurchaseInput {
  scoreAvailable: number;
  tier: SignalTierKey;
  scoring: ScoringSettings;
  tierLimits: ClueTierLimits;
  /** How many hints have already been bought in this tier this round. */
  purchasesUsedInTier: number;
  /** How many clues in this tier still have is_revealed = false. */
  unrevealedInTier: number;
  /** Explicit UI confirmation that the player accepts burning the signal. */
  confirmBurn: boolean;
}

export type HintPurchaseResult =
  | { ok: true; cost: number; newScore: number; burned: boolean }
  | { ok: false; code: HintErrorCode };

/**
 * Evaluates a hint purchase attempt against the dead-signal rules, in the
 * exact order specified by plan section 13 (the score/limit/confirmation
 * checks this function owns; tier_disabled is a caller-side precondition,
 * see the HintErrorCode doc comment above):
 *
 *   1. scoreAvailable must be > 0, else signal_burned.
 *   2. purchasesUsedInTier must be under the tier's limit, else
 *      tier_limit_reached.
 *   3. unrevealedInTier must be > 0, else tier_exhausted.
 *   4. If cost >= scoreAvailable (a burning purchase, including the exact
 *      boundary where cost equals score), confirmBurn must be true, else
 *      burn_confirmation_required.
 *   5. Success: score is deducted and clamped at 0. burned is true when the
 *      purchase brings score to exactly 0.
 */
export function evaluateHintPurchase(input: HintPurchaseInput): HintPurchaseResult {
  const {
    scoreAvailable,
    tier,
    scoring,
    tierLimits,
    purchasesUsedInTier,
    unrevealedInTier,
    confirmBurn,
  } = input;

  if (scoreAvailable <= 0) {
    return { ok: false, code: "signal_burned" };
  }

  if (purchasesUsedInTier >= tierLimit(tierLimits, tier)) {
    return { ok: false, code: "tier_limit_reached" };
  }

  if (unrevealedInTier <= 0) {
    return { ok: false, code: "tier_exhausted" };
  }

  const cost = tierCost(scoring, tier);

  if (cost >= scoreAvailable && !confirmBurn) {
    return { ok: false, code: "burn_confirmation_required" };
  }

  const newScore = clamp0(scoreAvailable - cost);
  return { ok: true, cost, newScore, burned: newScore === 0 };
}

export interface WrongGuessInput {
  scoreAvailable: number;
  wrongGuessCount: number;
  scoring: ScoringSettings;
}

export interface WrongGuessResult {
  newScore: number;
  newWrongGuessCount: number;
  /** True when this guess brought score down to exactly 0. */
  burned: boolean;
  /** True when this guess reached the max-wrong-guesses cap (round failed). */
  failed: boolean;
}

/**
 * Applies the flat wrong-guess penalty and advances the strike counter.
 *
 * Duplicate guesses (the player re-guessing a name already in the Bad Reads
 * list) never reach this function: the API layer rejects them for free
 * before scoring, per plan section 14. This function assumes every call is
 * a genuine new wrong guess.
 *
 * Wrong guesses still count toward the fail cap even once score is already
 * 0 (burning out does not end the round, decision 11), and they never
 * deduct below 0.
 */
export function applyWrongGuess(input: WrongGuessInput): WrongGuessResult {
  const { scoreAvailable, wrongGuessCount, scoring } = input;

  const newScore = clamp0(scoreAvailable - scoring.wrong_guess_penalty);
  const newWrongGuessCount = wrongGuessCount + 1;

  return {
    newScore,
    newWrongGuessCount,
    burned: newScore === 0,
    failed: newWrongGuessCount >= scoring.max_wrong_guesses,
  };
}

export type CorrectGuessOutcome = "won" | "solved_late";

export interface CorrectGuessResult {
  outcome: CorrectGuessOutcome;
  scoreAwarded: number;
}

/**
 * Resolves a correct guess. Score of 1 or more awards the remaining score
 * and counts as a win; score of exactly 0 is "solved too late" and awards
 * nothing. There is no minimum floor: a win at score 1 awards 1.
 */
export function resolveCorrectGuess(scoreAvailable: number): CorrectGuessResult {
  if (scoreAvailable >= 1) {
    return { outcome: "won", scoreAwarded: scoreAvailable };
  }
  return { outcome: "solved_late", scoreAwarded: 0 };
}

/**
 * Sanity helper: the theoretical maximum a round could ever spend on hints
 * if every tier were bought out to its purchase limit. With the shipped
 * defaults this is 400 + 600 + 700 + 500 = 2200, comfortably above the
 * 1,000 starting score, which is what guarantees the score always runs out
 * before the tier limits do (plan section 7 / decision 12).
 */
export function maxTheoreticalSpend(scoring: ScoringSettings, tierLimits: ClueTierLimits): number {
  const tiers: SignalTierKey[] = ["weak", "clear", "ping", "scan"];
  return tiers.reduce(
    (sum, tier) => sum + tierCost(scoring, tier) * tierLimit(tierLimits, tier),
    0,
  );
}
