/**
 * Manager Pulse tendencies, read into Trade Finder.
 *
 * ABSOLUTE RULE, restated from docs/manager-pulse-plan.md section 8.3: a
 * tendency never touches the VALUE math or the WINS math. Both sides of every
 * trade are still priced and simulated exactly as they are today. What lives
 * here may only ever affect three things: the acceptance band, by at most one
 * step (see rank.ts acceptanceOf), package construction ORDERING (see
 * engine.ts), and new reason sentences (see explain.ts). Nothing here computes
 * a value, a lineup fill, or a projected win, and nothing here is allowed to.
 *
 * PURE, same as everything else in lib/trade-finder/. Only TYPES are imported
 * from lib/manager-pulse; no SupabaseClient, no fetch, no capture, no service
 * call. A caller (the trade-ideas page) reads a Map<rosterId, ManagerTendency>
 * elsewhere, through the read-only lib/manager-pulse/service.ts
 * getManagerTendencies, and hands it in as plain data on TradeFinderInput.
 *
 * A NOTE ON WHAT "SAMPLE SIZE" MEANS HERE. TendencySlice.sampleSize counts
 * GRADED trades (lib/manager-pulse/trading.ts buildTendencySlice), which is
 * necessarily 0 whenever tradeCount is 0. So the general sample floor below
 * governs only the value-margin adjustment, which needs enough graded
 * evidence to trust an average; the zero-trade downgrade is judged on
 * tradeCount directly; a count of zero needs no floor to be trustworthy,
 * because it is an exact observation rather than an average that could be
 * noisy on a small sample.
 */

import type { ManagerTendency, TendencySlice } from "@/lib/manager-pulse/types";
import type { TradePosition } from "./types";

export type { ManagerTendency, TendencySlice };

/**
 * Fallbacks for the thresholds this module needs.
 *
 * THREE OF THESE ARE ADMIN SETTINGS AND MUST BE PASSED IN, not read from here.
 * `MIN_SAMPLE`, `BAND_STEP_MAX` and `FREQUENT_TRADES_PER_SEASON` mirror
 * `samples.minTradesForMargin`, `tendency.bandStepMax` and
 * `wording.tradesOftenPerSeason` in lib/manager-pulse/default-settings.ts, and
 * a copy of a number is a number that will eventually disagree with its
 * original. The engine stays pure, so it cannot read the settings row itself;
 * the CALLER reads it and passes `TendencyThresholds` down. These values exist
 * only so a caller that has not loaded settings (a test, an older call site)
 * still behaves sanely, and they are the same defaults the settings row ships.
 *
 * The remaining constants are genuinely local: they are scale factors for this
 * module's own bounded appetite score, not product judgements about what to
 * say, so there is nothing for an admin to tune.
 */
/**
 * The three thresholds an admin owns, threaded from the settings row through
 * the caller so the pure engine never has to know where they came from.
 */
export type TendencyThresholds = {
  /** Graded trades needed before an average is trusted. */
  minSample: number;
  /** The largest an acceptance band may move, in either direction. */
  bandStepMax: number;
  /** Trades a season at or above which a manager reads as trading often. */
  frequentTradesPerSeason: number;
};

/** The thresholds, falling back to the published defaults when none are given. */
export function resolveTendencyThresholds(
  given?: Partial<TendencyThresholds>,
): TendencyThresholds {
  return {
    minSample: given?.minSample ?? TENDENCY_DEFAULTS.MIN_SAMPLE,
    bandStepMax: given?.bandStepMax ?? TENDENCY_DEFAULTS.BAND_STEP_MAX,
    frequentTradesPerSeason:
      given?.frequentTradesPerSeason ?? TENDENCY_DEFAULTS.FREQUENT_TRADES_PER_SEASON,
  };
}

export const TENDENCY_DEFAULTS = {
  /** Graded trades needed before an average (margin, position lean) is trusted. */
  MIN_SAMPLE: 4,
  /** The largest an acceptance band may move, in either direction. */
  BAND_STEP_MAX: 1,
  /** Trades a season at or above this reads as "trades often". */
  FREQUENT_TRADES_PER_SEASON: 3,
  /**
   * The value-flow (positionAppetite) magnitude at which appetiteScore's
   * position term saturates at POSITION_COMPONENT_MAX. Chosen against this
   * codebase's own value scale, where a single startable player commonly
   * carries a value in the low thousands (see lib/trade-quality.ts and the
   * "points of trade value" wording throughout lib/trade-finder/explain.ts):
   * a net flow of this size at one position is a real, repeated lean rather
   * than one trade's rounding.
   */
  POSITION_APPETITE_SCALE: 2000,
  /** Ceiling on the position term alone, so it can never outweigh a favourite/avoid hit. */
  POSITION_COMPONENT_MAX: 0.6,
  /** How much naming a favourite player adds. */
  FAVOURITE_BONUS: 0.4,
  /** How much naming an avoided player subtracts. */
  AVOID_PENALTY: 0.4,
};

/**
 * Which slice of a tendency applies in this league, or null.
 *
 * `isDynasty` is TradeFinderInput's own boolean, already the structural fold
 * of the four-bucket Sleeper category down to two (see
 * lib/manager-pulse/types.ts lensForCategory, which this mirrors: dynasty and
 * best-ball-dynasty read the dynasty slice, everything else reads redraft).
 * NEVER falls back to the other slice: a dynasty read of a manager we have
 * only ever seen in redraft is an absence, not an approximation, so a null
 * `dynasty` field here returns null rather than the `redraft` one.
 */
export function sliceFor(
  tendency: ManagerTendency | undefined,
  isDynasty: boolean,
): TendencySlice | null {
  if (!tendency) return null;
  return isDynasty ? tendency.dynasty : tendency.redraft;
}

function clampSteps(raw: number, max: number): number {
  const bound = Math.max(0, max);
  if (raw > 0) return Math.min(raw, bound);
  // `|| 0` turns a -0 result (raw negative, bound 0) into a plain 0: -0 and 0
  // compare equal with ==, but not with the strict equality most test
  // assertions use, and a caller has no reason to ever see the difference.
  if (raw < 0) return Math.max(raw, -bound) || 0;
  return 0;
}

/**
 * How the acceptance band should move for this counterparty, in steps.
 *
 * -1, 0 or +1 before clamping; clamped to `settings.bandStepMax` either way,
 * so an admin who dials the cap to 0 gets exactly the behaviour that implies:
 * no tendency ever moves a band, whatever the trading history says.
 *
 * The reason string is a fragment the caller composes into its own sentence,
 * and it always names the figures behind the adjustment: a fragment with no
 * number in it is exactly the "noise wearing a suit" the sample-floor rule
 * exists to prevent.
 */
export function bandAdjustment(
  slice: TendencySlice | null,
  settings: { minSample: number; bandStepMax: number; frequentTradesPerSeason?: number },
): { steps: number; reason: string | null } {
  const nothing = { steps: 0, reason: null } as const;
  if (!slice) return nothing;

  // See the file header: a zero trade count is exact, not an average, so it
  // is judged before (and independently of) the graded-sample floor below.
  if (slice.tradeCount === 0) {
    return {
      steps: clampSteps(-1, settings.bandStepMax),
      reason: `has completed 0 trades in the window`,
    };
  }

  if (slice.sampleSize < settings.minSample) return nothing;

  const tradesOften =
    slice.tradesPerSeason >=
    (settings.frequentTradesPerSeason ?? TENDENCY_DEFAULTS.FREQUENT_TRADES_PER_SEASON);
  const paysUp = typeof slice.avgValueMargin === "number" && slice.avgValueMargin < 0;
  if (tradesOften && paysUp) {
    const pct = Math.round(Math.abs(slice.avgValueMargin as number) * 100);
    return {
      steps: clampSteps(1, settings.bandStepMax),
      reason:
        `trades often (${slice.tradeCount} trades, ${slice.tradesPerSeason.toFixed(1)} a season) ` +
        `and averages ${pct}% under market over ${slice.sampleSize} graded trades`,
    };
  }

  return nothing;
}

/**
 * Would this manager plausibly want this player? A ranking nudge, never a
 * filter: a manager's history is evidence about what they like, not a rule
 * about what they will consider, so this returns a small bounded number
 * rather than a boolean, and it is used only to order candidates that are
 * already legal offers.
 *
 * Bounded to roughly [-1, 1]: the position term saturates at
 * POSITION_COMPONENT_MAX, and the favourite/avoid bonus is a flat add, so the
 * combined total cannot run away even when both fire in the same direction.
 * Zero for a null slice, and zero when neither a position nor a player id is
 * given.
 */
export function appetiteScore(
  slice: TendencySlice | null,
  position: TradePosition | null,
  playerId: string | null,
): number {
  if (!slice) return 0;
  let score = 0;

  if (position) {
    const raw = slice.positionAppetite[position];
    if (typeof raw === "number" && raw !== 0) {
      const magnitude = Math.min(
        Math.abs(raw) / TENDENCY_DEFAULTS.POSITION_APPETITE_SCALE,
        TENDENCY_DEFAULTS.POSITION_COMPONENT_MAX,
      );
      score += Math.sign(raw) * magnitude;
    }
  }

  if (playerId) {
    if (slice.favouritePlayerIds.includes(playerId)) score += TENDENCY_DEFAULTS.FAVOURITE_BONUS;
    if (slice.avoidPlayerIds.includes(playerId)) score -= TENDENCY_DEFAULTS.AVOID_PENALTY;
  }

  return Math.max(-1, Math.min(1, score));
}

/**
 * True when this manager has never moved a pick and a pick-based offer would
 * be a waste of a suggestion slot.
 *
 * Requires BOTH `picksTraded === 0` and enough trades to call it a pattern
 * (`tradeCount >= minSample`), per section 8.3: zero picks in one trade is
 * not a pattern, it is one trade. Gated on the raw trade count rather than
 * the graded sample, because moving a pick or not is visible on every trade
 * whether or not Signal Check graded it.
 */
export function avoidsPicks(slice: TendencySlice | null, minSample: number): boolean {
  if (!slice) return false;
  return slice.picksTraded === 0 && slice.tradeCount >= minSample;
}
