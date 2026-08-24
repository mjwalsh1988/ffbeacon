/**
 * From "what he adds" to "what to bid".
 *
 * The split that makes this work is between VALUE and PRICE, and the old
 * calculator collapsed them into one number.
 *
 *   Value is what he is worth to you: the lineup upgrade, adjusted for how much
 *   you trust it and how badly you need the position. It sets the ceiling, and
 *   nothing about your opponents may raise it. Paying more than he is worth
 *   because a rival is rich is how managers lose seasons in October.
 *
 *   Price is what it takes to win him: the same upgrade seen through your
 *   league's wallets, its appetite for this position, and what it has actually
 *   paid for adds like this before. It can only ever sit at or under the value.
 *
 * So the output is a ladder rather than a range. The walk-away number is the
 * most useful thing on the page, because the most expensive FAAB mistake is not
 * bidding too little, it is winning an auction you should have lost.
 *
 * Pure.
 */

import type {
  AggressionLabel,
  BidLadder,
  FaabConfidence,
  FaabSettings,
  FaabSignal,
  MarginalValue,
  MarketRead,
  NeedLevel,
} from "./types";
import { combinedMultiplier, combinedSpread } from "./signals";

export type LadderInput = {
  marginal: MarginalValue | null;
  /** Player-quality signals. These move VALUE. */
  playerSignals: FaabSignal[];
  /** Market signals (rival money, contested-ness, urgency). These move PRICE. */
  marketSignals: FaabSignal[];
  market: MarketRead;
  remainingBudget: number;
  needLevel: NeedLevel;
  settings: FaabSettings;
  /** How thin the data underneath this answer is. */
  confidence: FaabConfidence;
};

export type LadderOutput = {
  ladder: BidLadder;
  aggressionLabel: AggressionLabel;
  isDumpCandidate: boolean;
  headline: string;
  explanation: string;
  notices: string[];
  /** 0 to 1. How big an upgrade this is on our own scale. */
  upgradeStrength: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number): string {
  return n.toFixed(1);
}

/**
 * How big an upgrade is this, on a 0 to 1 scale?
 *
 * Points answer "does this change my Sunday" and playoff odds answer "does this
 * change my season". Weighting them together stops two failure modes: a player
 * who adds real points to a team that is already eliminated, and a tiny points
 * bump that happens to swing a coin-flip playoff race.
 */
export function upgradeStrengthOf(
  marginal: MarginalValue | null,
  settings: FaabSettings["marginal"],
): number {
  if (!marginal) return 0;

  const pointsTerm = clamp(
    marginal.netPointsPerWeek / Math.max(1e-6, settings.bigUpgradePointsPerWeek),
    0,
    1.25,
  );

  const oddsGain =
    marginal.playoffOddsAfter !== null && marginal.playoffOddsBefore !== null
      ? marginal.playoffOddsAfter - marginal.playoffOddsBefore
      : null;

  if (oddsGain === null) return clamp(pointsTerm, 0, 1);

  const oddsTerm = clamp(oddsGain / Math.max(1e-6, settings.bigUpgradeOddsPoints), 0, 1.25);
  const w = clamp(settings.oddsWeight, 0, 1);
  return clamp(pointsTerm * (1 - w) + oddsTerm * w, 0, 1);
}

/**
 * Where this add sits in the league's own price history.
 *
 * A big upgrade should map to the expensive end of what this room actually
 * pays, a marginal one to the cheap end. This is the correction that turns a
 * model number into a number that wins in THIS league, where the going rate for
 * a starter might be 8 or might be 45.
 */
function historicalPrice(
  market: MarketRead,
  upgradeStrength: number,
  settings: FaabSettings["market"],
): number | null {
  if (!settings.history.enabled || !market.comparable) return null;
  const { p25, median, p75 } = market.comparable;
  if (upgradeStrength <= 0.5) {
    const t = upgradeStrength / 0.5;
    return p25 + (median - p25) * t;
  }
  const t = (upgradeStrength - 0.5) / 0.5;
  return median + (p75 - median) * t;
}

function aggressionFor(isDump: boolean, pctOfBudget: number): AggressionLabel {
  if (isDump) return "Empty the Clip";
  if (pctOfBudget >= 60) return "Empty the Clip";
  if (pctOfBudget >= 45) return "Aggressive";
  if (pctOfBudget >= 15) return "Balanced";
  return "Conservative";
}

export function buildLadder(input: LadderInput): LadderOutput {
  const { marginal, market, settings, remainingBudget } = input;
  const notices: string[] = [];

  const budget = Math.max(0, Math.floor(remainingBudget || 0));
  const upgradeStrength = upgradeStrengthOf(marginal, settings.marginal);

  const needMultiplier =
    settings.needMultipliers[input.needLevel] ?? settings.needMultipliers.medium;
  const playerMultiplier = combinedMultiplier(input.playerSignals);
  const marketMultiplier = combinedMultiplier(input.marketSignals);
  const spread = combinedSpread([...input.playerSignals, ...input.marketSignals]);

  // ---- VALUE: what he is worth to you, before anyone else is considered -----
  const worthPct = clamp(
    upgradeStrength * settings.marginal.maxPctFromUpgrade * needMultiplier * playerMultiplier,
    0,
    100,
  );

  // ---- PRICE: what it should take to win him ------------------------------
  let likelyPct = clamp(worthPct * marketMultiplier, 0, 100);
  let likely = Math.round((likelyPct / 100) * budget);

  const fromHistory = historicalPrice(market, upgradeStrength, settings.market);
  if (fromHistory !== null) {
    const w = clamp(settings.market.history.blendWeight, 0, 1);
    likely = Math.round(likely * (1 - w) + fromHistory * w);
    notices.push(
      `Blended with what this league actually pays: ${market.comparable?.sampleSize} winning bids across ${market.comparable?.seasonsCovered.join(", ")} run ${market.comparable?.p25} to ${market.comparable?.p75}, median ${market.comparable?.median}.`,
    );
  }

  // ---- The dump, earned rather than assumed --------------------------------
  const oddsGain =
    marginal?.playoffOddsAfter != null && marginal?.playoffOddsBefore != null
      ? marginal.playoffOddsAfter - marginal.playoffOddsBefore
      : null;
  const dumpCfg = settings.leagueDump;
  const alreadyCooked =
    marginal?.playoffOddsBefore != null &&
    marginal.playoffOddsBefore <= dumpCfg.loserOddsCeiling;

  const isDumpCandidate =
    dumpCfg.enabled &&
    !alreadyCooked &&
    ((oddsGain !== null && oddsGain >= dumpCfg.oddsPointsThreshold) ||
      (marginal !== null &&
        marginal.netPointsPerWeek >= dumpCfg.pointsPerWeekThreshold));

  let walkAway: number;

  if (isDumpCandidate) {
    const range = dumpCfg.ranges[input.needLevel] ?? dumpCfg.ranges.medium;
    likely = Math.round((clamp(range.minPct, 0, 100) / 100) * budget);
    walkAway = Math.round((clamp(range.maxPct, 0, 100) / 100) * budget);
    notices.push(settings.copy.dumpNote);
  } else {
    const trimmed = worthPct * (1 - settings.ladder.walkAwayTrimPct / 100);
    walkAway = Math.round((clamp(trimmed, 0, 100) / 100) * budget);
  }

  if (alreadyCooked && dumpCfg.enabled) {
    notices.push(
      `Your playoff odds sit at ${marginal?.playoffOddsBefore?.toFixed(0)}%. One waiver claim does not fix that, so this is not the week to empty the budget no matter how good he looks.`,
    );
  }

  // Widen the ladder when the signals said this player is unpredictable.
  const widened = Math.round(likely * (1 + spread));
  let aggressive = Math.max(
    widened,
    Math.round(likely * (1 + settings.ladder.aggressiveAbovePct / 100)),
  );

  // Never recommend paying more than he is worth, and never invert the rungs.
  //
  // When the market price runs past his worth to you, all three rungs land on
  // the same number, and a ladder printed as "34, 34, 34" reads as a broken
  // calculator rather than as the answer it is. So we remember that it happened
  // and say it in words further down.
  walkAway = Math.min(walkAway, budget);
  const cappedByWorth = aggressive > walkAway || likely > walkAway;
  aggressive = Math.min(aggressive, Math.max(walkAway, 0));
  likely = Math.min(likely, aggressive);

  // A player who starts for you is worth at least a token bid; a player who
  // never cracks the lineup is allowed to be worth nothing, and saying zero is
  // more useful than inventing a dollar.
  const startsSomewhere = (marginal?.weeksStarting ?? 0) > 0;
  if (budget > 0 && startsSomewhere && !isDumpCandidate) {
    const floor = settings.ladder.minStartableBid;
    if (likely < floor) likely = Math.min(floor, budget);
    if (aggressive < likely) aggressive = likely;
    if (walkAway < aggressive) walkAway = aggressive;
  }

  const likelyPctFinal = budget > 0 ? (likely / budget) * 100 : 0;
  likelyPct = likelyPctFinal;
  const aggressionLabel = aggressionFor(isDumpCandidate, likelyPctFinal);

  // ---- Copy ----------------------------------------------------------------
  const { headline, explanation } = describe({
    marginal,
    market,
    isDumpCandidate,
    likely,
    walkAway,
    upgradeStrength,
    cappedByWorth,
  });

  if (input.confidence === "low") notices.push(settings.copy.thinDataNote);

  return {
    ladder: {
      walkAway,
      likely,
      aggressive,
      likelyPct: Math.round(likelyPctFinal),
      budgetAfterLikely: Math.max(0, budget - likely),
    },
    aggressionLabel,
    isDumpCandidate,
    headline,
    explanation,
    notices,
    upgradeStrength,
  };
}

/**
 * The words.
 *
 * Written to name the two or three things actually driving the number, because
 * a recommendation a reader cannot argue with is one they cannot trust either.
 */
function describe({
  marginal,
  market,
  isDumpCandidate,
  likely,
  walkAway,
  upgradeStrength,
  cappedByWorth,
}: {
  marginal: MarginalValue | null;
  market: MarketRead;
  isDumpCandidate: boolean;
  likely: number;
  walkAway: number;
  upgradeStrength: number;
  /** True when the market price ran past his worth and the rungs collapsed. */
  cappedByWorth: boolean;
}): { headline: string; explanation: string } {
  if (!marginal) {
    return {
      headline: "Not enough to price him",
      explanation:
        "No weekly projections are published for this player, so there is nothing to measure. Market value and league size are all we have here.",
    };
  }

  if (marginal.isBenchOnly) {
    return {
      headline: "Not an upgrade",
      explanation: `He does not beat what you can already start across your ${marginal.weeksConsidered} remaining week${marginal.weeksConsidered === 1 ? "" : "s"}. That makes him insurance, which is a fine reason to add someone and a bad reason to spend. Bid what a bench spot is worth.`,
    };
  }

  const parts: string[] = [];
  parts.push(
    `Adds about ${round1(marginal.netPointsPerWeek)} points a week over ${marginal.weeksConsidered} week${marginal.weeksConsidered === 1 ? "" : "s"}.`,
  );

  if (marginal.playoffOddsBefore !== null && marginal.playoffOddsAfter !== null) {
    const gain = marginal.playoffOddsAfter - marginal.playoffOddsBefore;
    parts.push(
      Math.abs(gain) >= 0.5
        ? `Playoff odds ${marginal.playoffOddsBefore.toFixed(0)}% to ${marginal.playoffOddsAfter.toFixed(0)}%.`
        : `Playoff odds barely move from ${marginal.playoffOddsBefore.toFixed(0)}%, so your season is not riding on this.`,
    );
  }

  // Named rather than asserted: the figure has to be measured against one
  // specific cut, but the cut itself is the reader's call and the shortlist
  // below the summary is where the alternatives are.
  if (marginal.dropCost) {
    parts.push(
      marginal.dropCost.pointsPerWeek > 0.1
        ? `Measured against cutting ${marginal.dropCost.name}, the cheapest spot to clear, which costs ${round1(marginal.dropCost.pointsPerWeek)} a week.`
        : `Measured against cutting ${marginal.dropCost.name}, the cheapest spot to clear, which costs you nothing.`,
    );
  }

  if (market.interestedRivals === 0) {
    parts.push("Nobody else would start him, so you are bidding against yourself.");
  } else if (market.interestedRivals !== null && market.interestedRivals >= 2) {
    parts.push(`${market.interestedRivals} rivals would start him too, so expect company.`);
  }

  parts.push(
    isDumpCandidate
      ? `Spend. ${likely} gets it done; ${walkAway} is where even this stops being worth it.`
      : cappedByWorth
        ? `He is worth ${likely} to you and the room is likely to pay more than that. Bid ${likely} and let him go above it: there is no version of this where paying over his worth is the right move.`
        : `${likely} should win him. Above ${walkAway} you are overpaying, and letting him go is the right move.`,
  );

  const headline = isDumpCandidate
    ? "Empty the clip"
    : upgradeStrength >= 0.6
      ? "Priority add"
      : upgradeStrength >= 0.3
        ? "Worth a real bid"
        : "Cheap upgrade";

  return { headline, explanation: parts.join(" ") };
}
