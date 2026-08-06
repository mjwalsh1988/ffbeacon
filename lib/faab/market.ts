/**
 * The competition.
 *
 * A bid is not a valuation, it is an auction. The old calculator priced the
 * player and stopped, which is why it would confidently recommend 30% of your
 * budget for a player nobody else in your league wanted, and the same 30% for
 * one that four teams with full wallets were about to chase.
 *
 * Three things here that the model could not see before:
 *
 *   1. What your rivals can actually spend. Sleeper reports every team's FAAB
 *      already spent, so we know what everyone has left. If they are broke, you
 *      win cheap, and no amount of player quality changes that.
 *   2. How many of them want him. We run the same swap test against their
 *      rosters. One interested team is a bargain; five is a bidding war.
 *   3. What this league actually pays. Every winning bid is preserved in the
 *      stored transaction record, so the going rate is a measurement rather
 *      than a guess. Some rooms never clear 8%; some spend 40% on a backup.
 *
 * Plus the one thing everyone forgets: FAAB left over in January bought nothing.
 * Twelve dollars in week 2 and twelve dollars in week 14 are not the same money.
 *
 * Pure.
 */

import type {
  ComparableBids,
  FaabSignal,
  MarketRead,
  MarketSettings,
} from "./types";

export type MarketInput = {
  yourBudget: number;
  /** Every other team's remaining budget. */
  rivalBudgets: number[];
  /**
   * How many rival teams this player would meaningfully improve, from running
   * the swap against their rosters. Null when we could not check.
   */
  interestedRivals: number | null;
  rivalsChecked: number | null;
  comparable: ComparableBids | null;
  currentWeek: number;
  /** Last week of the regular season for this league. */
  lastRegularWeek: number;
  settings: MarketSettings;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Nearest-rank percentile. Small samples make interpolation false precision. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(clamp(p, 0, 1) * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}

/**
 * Turn this league's winning waiver bids into a distribution.
 *
 * Zero-dollar claims are dropped: in most leagues they are the free-agent
 * pickups that happen after waivers clear, and counting them would drag the
 * median of "what things cost" down to nothing.
 */
export function summarizeComparableBids(
  bids: Array<{ amount: number; season: number }>,
  minSamples: number,
): ComparableBids | null {
  const priced = bids.filter((b) => Number.isFinite(b.amount) && b.amount > 0);
  if (priced.length < minSamples) return null;

  const amounts = priced.map((b) => b.amount).sort((a, b) => a - b);
  return {
    sampleSize: amounts.length,
    median: median(amounts),
    p25: percentile(amounts, 0.25),
    p75: percentile(amounts, 0.75),
    seasonsCovered: Array.from(new Set(priced.map((b) => b.season))).sort(),
  };
}

function toMultiplier(strength: number, maxAdjustPct: number): number {
  return 1 + clamp(strength, -1, 1) * (maxAdjustPct / 100);
}

/**
 * How much money is pointed at you.
 *
 * Two halves: how the richest rival's wallet compares to yours (which sets the
 * ceiling on what you can be outbid by) and how many rivals are above you at
 * all (which sets how many times you can be outbid).
 */
function rivalBudgetSignal(input: MarketInput, read: MarketRead): FaabSignal | null {
  const cfg = input.settings.rivalBudget;
  if (!cfg.enabled || input.rivalBudgets.length === 0) return null;

  const richest = read.richestRivalBudget ?? 0;
  const ratio = richest / Math.max(1, input.yourBudget);
  const ratioTerm = clamp(ratio - 1, -1, 1);
  const richerShare = read.rivalsRicher / input.rivalBudgets.length;
  const shareTerm = clamp(richerShare * 2 - 1, -1, 1);
  const strength = 0.6 * ratioTerm + 0.4 * shareTerm;
  if (Math.abs(strength) < 0.1) return null;

  const pressured = strength > 0;
  return {
    id: "rival-budget",
    label: pressured ? "Your rivals have money" : "Your rivals are broke",
    detail: pressured
      ? `${read.rivalsRicher} of ${input.rivalBudgets.length} rivals have more FAAB than you; the richest has ${richest}. You are the one stretching.`
      : `The richest rival has only ${richest}. You do not need to pay full price to win this.`,
    tone: pressured ? "bad" : "good",
    multiplier: toMultiplier(strength, cfg.maxAdjustPct),
    spread: 0,
  };
}

/** How many of them actually want him. */
function rivalNeedSignal(input: MarketInput): FaabSignal | null {
  const cfg = input.settings.rivalNeed;
  if (!cfg.enabled) return null;
  const { interestedRivals: interested, rivalsChecked: checked } = input;
  if (interested === null || checked === null || checked === 0) return null;

  let strength: number;
  if (interested === 0) strength = -1;
  else if (interested === 1) strength = -0.3;
  else strength = clamp((interested - 1) / 3, 0, 1);

  const contested = interested >= 2;
  return {
    id: "rival-need",
    label: contested
      ? "Other teams want him too"
      : interested === 1
        ? "One other team might want him"
        : "Nobody else needs him",
    detail:
      interested === 0
        ? `He would not start on any of the other ${checked} rosters. You are probably bidding against nobody.`
        : `${interested} of ${checked} rosters would start him. ${contested ? "Expect company." : "Light competition."}`,
    tone: contested ? "bad" : "good",
    multiplier: toMultiplier(strength, cfg.maxAdjustPct),
    spread: 0,
  };
}

/**
 * What the calendar is worth.
 *
 * Early, your budget has a whole season of claims ahead of it and hoarding has
 * real option value. Late, unspent FAAB is confetti. The curve between the two
 * is linear because nothing about the real behavior justifies more shape than
 * that, and a simple ramp is one an admin can reason about.
 */
export function urgencyMultiplier(input: MarketInput): number {
  const cfg = input.settings.urgency;
  if (!cfg.enabled) return 1;

  const early = 1 - cfg.maxEarlyDiscountPct / 100;
  const late = 1 + cfg.maxLateBoostPct / 100;

  if (input.currentWeek <= cfg.earlySeasonWeek) return early;
  if (input.currentWeek >= cfg.lateSeasonWeek) return late;

  const span = cfg.lateSeasonWeek - cfg.earlySeasonWeek;
  const t = span > 0 ? (input.currentWeek - cfg.earlySeasonWeek) / span : 1;
  return early + (late - early) * t;
}

function urgencySignal(input: MarketInput, multiplier: number): FaabSignal | null {
  if (!input.settings.urgency.enabled) return null;
  if (Math.abs(multiplier - 1) < 0.03) return null;

  const weeksLeft = Math.max(0, input.lastRegularWeek - input.currentWeek + 1);
  const late = multiplier > 1;
  return {
    id: "urgency",
    label: late ? "Money you do not spend is wasted" : "It is early, budget has option value",
    detail: late
      ? `${weeksLeft} regular season week${weeksLeft === 1 ? "" : "s"} left. Leftover FAAB buys nothing, so the right bid climbs from here.`
      : `Week ${input.currentWeek}. Every dollar now is one you cannot spend on whoever breaks out in November.`,
    tone: "neutral",
    multiplier,
    spread: 0,
  };
}

export function buildMarket(input: MarketInput): {
  read: MarketRead;
  signals: FaabSignal[];
} {
  const rivals = [...input.rivalBudgets].sort((a, b) => a - b);
  const read: MarketRead = {
    yourBudget: input.yourBudget,
    rivalsRicher: rivals.filter((b) => b > input.yourBudget).length,
    richestRivalBudget: rivals.length > 0 ? rivals[rivals.length - 1] : null,
    medianRivalBudget: rivals.length > 0 ? median(rivals) : null,
    interestedRivals: input.interestedRivals,
    rivalsChecked: input.rivalsChecked,
    comparable: input.comparable,
    weeksLeft: Math.max(0, input.lastRegularWeek - input.currentWeek + 1),
    urgencyMultiplier: urgencyMultiplier(input),
  };

  const signals = [
    rivalNeedSignal(input),
    rivalBudgetSignal(input, read),
    urgencySignal(input, read.urgencyMultiplier),
  ].filter((s): s is FaabSignal => s !== null);

  return { read, signals };
}
