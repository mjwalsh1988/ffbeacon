/**
 * From "what he adds" to "what to bid".
 *
 * The split that makes this work is between VALUE and PRICE.
 *
 *   Value is what he is worth to you: the lineup upgrade, adjusted for how
 *   much we trust it. It sets the ceiling, and nothing about your opponents
 *   may raise it. Paying more than he is worth because a rival is rich is how
 *   managers lose seasons in October.
 *
 *   Price is what it takes to win him, and it comes from the auction model in
 *   lib/faab/auction.ts (league mode) or the market cells in
 *   lib/faab/priors-read.ts (manual mode). Both answer the same question: what
 *   is the chance a bid of b beats everyone else.
 *
 * THE READER CHOOSES THE GOAL, and that is the change that matters most here.
 * "Good value" aims at a 60% chance and never pays over worth. "Make sure I
 * win" aims at 90% and may pay a stated amount over worth, because sometimes
 * the player is the season and the budget is not. Both numbers are computed
 * every time and carried in `bidsByGoal`, so switching costs no round trip.
 *
 * The walk-away is still the most useful number on the page: the most
 * expensive FAAB mistake is not bidding too little, it is winning an auction
 * you should have lost.
 *
 * Pure.
 */

import type {
  AggressionLabel,
  BidLadder,
  BidRung,
  FaabConfidence,
  FaabSettings,
  FaabSignal,
  GoalKey,
  MarginalValue,
  MarketRead,
  NeedLevel,
} from "./types";
import { combinedMultiplier } from "./signals";

export type LadderInput = {
  marginal: MarginalValue | null;
  /** Player-quality signals. These move VALUE. */
  playerSignals: FaabSignal[];
  /** Market signals. These are reported; they no longer move the bid. */
  marketSignals: FaabSignal[];
  market: MarketRead;
  /** What the reader has left to spend, in dollars. */
  remainingBudget: number;
  /**
   * The league's FULL starting budget, in dollars. Every model figure is a
   * share of this, because a share is the only thing comparable between a
   * $100 league and a $1,000 one.
   */
  totalBudget: number;
  /** The smallest bid this league accepts. */
  minBid: number;
  needLevel: NeedLevel;
  /**
   * League mode reads need off the roster: the lineup swap already knows how
   * many weeks he starts and what he displaces, so multiplying by a need level
   * the reader also picked counted the same thing twice. Manual mode has no
   * roster, so there the control is the only way to say it.
   */
  mode: "league" | "manual";
  settings: FaabSettings;
  confidence: FaabConfidence;
  /** Which question the reader asked. */
  goal: GoalKey;
  /**
   * Chance a bid of this many dollars wins. From the auction simulation in
   * league mode, from the market cell in manual mode, null when neither is
   * available (no published budgets, no priors) and the page says so.
   */
  winChanceAt?: ((dollars: number) => number) | null;
  /** The highest rival bid we expect, in dollars. */
  rivalTop?: { p50: number; p75: number } | null;
  /** Share of simulated runs where nobody else bid at all, 0 to 1. */
  noRivalShare?: number | null;
  /**
   * Chopped mode computes worth its own way (survival, not playoff odds), so
   * it hands the finished share of budget in rather than having it rebuilt.
   */
  worthPctOverride?: number | null;
  /** Rivals whose lineup he would crack. Drives the contested dump trigger. */
  interestedRivals?: number | null;
  /** Superflex league where one of the reader's starting quarterbacks is out. */
  superflexQbEmergency?: boolean;
  /** Chopped leagues get their own headline and their own reasons. */
  choppedHeadline?: string | null;
  /**
   * Dynasty and keeper leagues only: what he is worth as an ASSET, as a share
   * of the full budget, and how much of the answer that should be.
   *
   * A contender is buying weeks and a rebuilder is buying a player, and the
   * old model could only say the first thing. The weight comes from the
   * reader's own team status, so the same 22-year-old receiver is priced
   * differently for the team chasing a title and the team stockpiling.
   */
  dynastyValuePct?: number | null;
  dynastyBlendWeight?: number | null;
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
  /** The share of the FULL budget he is worth to this roster. */
  worthPct: number;
  /**
   * Worth from LINEUP POINTS ALONE, before any dynasty value is blended in.
   *
   * Reported separately because the dynasty reason is only true when the
   * asset half is actually raising the bid, and comparing against the blended
   * figure compares it partly against itself: the blend is pulled toward the
   * dynasty number, so the sentence went quiet exactly when that number was
   * doing the most work.
   */
  pointsWorthPct: number;
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
 * Points answer "does this change my Sunday", playoff odds answer "does this
 * change my season", and title odds answer "does it change how the season
 * ends". Weighting them together stops two failure modes: a player who adds
 * real points to a team that is already eliminated, and a tiny points bump
 * that happens to swing a coin-flip playoff race.
 */
export function upgradeStrengthOf(
  marginal: MarginalValue | null,
  settings: FaabSettings["marginal"],
  playoffValue?: FaabSettings["playoffValue"],
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

  let strength: number;
  if (oddsGain === null) {
    strength = clamp(pointsTerm, 0, 1);
  } else {
    const oddsTerm = clamp(oddsGain / Math.max(1e-6, settings.bigUpgradeOddsPoints), 0, 1.25);
    const w = clamp(settings.oddsWeight, 0, 1);
    strength = clamp(pointsTerm * (1 - w) + oddsTerm * w, 0, 1);
  }

  // Title odds, when we have them. A player who moves a bubble team into the
  // bracket and a player who turns a bracket team into a favourite are two
  // different buys, and playoff odds alone cannot tell them apart.
  const titleGain =
    marginal.titleOddsAfter !== null && marginal.titleOddsBefore !== null
      ? marginal.titleOddsAfter - marginal.titleOddsBefore
      : null;
  if (playoffValue?.enabled && titleGain !== null) {
    const titleTerm = clamp(
      titleGain / Math.max(1e-6, playoffValue.bigTitleOddsPoints),
      0,
      1.25,
    );
    const w = clamp(playoffValue.titleOddsWeight, 0, 1);
    strength = clamp(strength * (1 - w) + titleTerm * w, 0, 1);
  }

  return strength;
}

function aggressionFor(isDump: boolean, pctOfBudget: number): AggressionLabel {
  if (isDump) return "Empty the Clip";
  if (pctOfBudget >= 60) return "Empty the Clip";
  if (pctOfBudget >= 45) return "Aggressive";
  if (pctOfBudget >= 15) return "Balanced";
  return "Conservative";
}

/** Dollars from a share of the FULL budget, never more than the reader holds. */
function dollarsFromPct(pct: number, totalBudget: number, remaining: number): number {
  const raw = Math.round((clamp(pct, 0, 100) / 100) * Math.max(0, totalBudget));
  return clamp(raw, 0, Math.max(0, remaining));
}

function rungFor(
  dollars: number,
  totalBudget: number,
  winChanceAt: ((d: number) => number) | null | undefined,
): BidRung {
  return {
    dollars,
    pct: totalBudget > 0 ? (dollars / totalBudget) * 100 : 0,
    winChance: winChanceAt ? clamp(winChanceAt(dollars), 0, 1) : null,
  };
}

export function buildLadder(input: LadderInput): LadderOutput {
  const { marginal, market, settings, remainingBudget } = input;
  const notices: string[] = [];

  const budget = Math.max(0, Math.floor(remainingBudget || 0));
  const totalBudget = Math.max(1, Math.floor(input.totalBudget || budget || 1));
  const minBid = Math.max(0, Math.floor(input.minBid || 0));
  const winChanceAt = input.winChanceAt ?? null;

  const upgradeStrength = upgradeStrengthOf(marginal, settings.marginal, settings.playoffValue);

  const needMultiplier =
    input.mode === "league"
      ? 1
      : (settings.needMultipliers[input.needLevel] ?? settings.needMultipliers.medium);
  const playerMultiplier = combinedMultiplier(input.playerSignals);

  // ---- VALUE: what he is worth to you, before anyone else is considered ----
  const pointsWorthPct = clamp(
    upgradeStrength * settings.marginal.maxPctFromUpgrade * needMultiplier * playerMultiplier,
    0,
    100,
  );

  // In a dynasty or keeper league, part of what a claim buys is the player
  // himself. How much depends on who is asking: a contender is buying the
  // weeks between now and the final, a rebuilder is buying the asset.
  const blendWeight =
    settings.dynastyValue.enabled &&
    input.dynastyValuePct != null &&
    input.dynastyBlendWeight != null
      ? clamp(input.dynastyBlendWeight, 0, 1)
      : 0;
  const blendedWorthPct =
    blendWeight > 0
      ? clamp(
          pointsWorthPct * (1 - blendWeight) + clamp(input.dynastyValuePct ?? 0, 0, 100) * blendWeight,
          0,
          100,
        )
      : pointsWorthPct;

  const worthPct =
    input.worthPctOverride !== null && input.worthPctOverride !== undefined
      ? clamp(input.worthPctOverride, 0, 100)
      : blendedWorthPct;

  // ---- The dump, earned rather than assumed --------------------------------
  const oddsGain =
    marginal?.playoffOddsAfter != null && marginal?.playoffOddsBefore != null
      ? marginal.playoffOddsAfter - marginal.playoffOddsBefore
      : null;
  const dumpCfg = settings.leagueDump;
  const alreadyCooked =
    marginal?.playoffOddsBefore != null &&
    marginal.playoffOddsBefore <= dumpCfg.loserOddsCeiling;

  const startsSomewhere = (marginal?.weeksStarting ?? 0) > 0;
  // Two new triggers beside the original two. A player four rivals would start
  // is a player the room is about to fight over, and in superflex a starting
  // quarterback going out is the one injury that cannot be streamed around.
  const contested =
    input.interestedRivals != null &&
    input.interestedRivals >= dumpCfg.contestedRivals &&
    startsSomewhere;
  const qbEmergency = dumpCfg.superflexQbStarterOut && input.superflexQbEmergency === true;

  const isDumpCandidate =
    dumpCfg.enabled &&
    !alreadyCooked &&
    ((oddsGain !== null && oddsGain >= dumpCfg.oddsPointsThreshold) ||
      (marginal !== null && marginal.netPointsPerWeek >= dumpCfg.pointsPerWeekThreshold) ||
      contested ||
      qbEmergency);

  let walkAwayPct = worthPct;
  if (isDumpCandidate) {
    // THE DUMP RANGE IS THE SECOND READER OF `needLevel`, and in league mode
    // it must be deaf to it for the same reason `worthPct` is. The page tells
    // the reader that the need control is manual mode only, and it was still
    // moving the league-mode walk-away between 75% and 100% of the budget on
    // any claim that tripped the dump: the most important number on the card,
    // moved by a control the page says does nothing. League mode takes the
    // middle range; manual mode, where the reader is the only source of need,
    // keeps the one they picked.
    const range =
      input.mode === "league"
        ? dumpCfg.ranges.medium
        : (dumpCfg.ranges[input.needLevel] ?? dumpCfg.ranges.medium);
    walkAwayPct = Math.max(walkAwayPct, clamp(range.maxPct, 0, 100));
    notices.push(settings.copy.dumpNote);
  }

  if (alreadyCooked && dumpCfg.enabled) {
    notices.push(
      `Your playoff odds sit at ${marginal?.playoffOddsBefore?.toFixed(0)}%. One waiver claim does not fix that, so this is not the week to empty the budget no matter how good he looks.`,
    );
  }

  let walkAwayDollars = dollarsFromPct(walkAwayPct, totalBudget, budget);
  // A player who starts for you is worth at least a token bid. A player who
  // never cracks the lineup is allowed to be worth nothing, and saying zero is
  // more useful than inventing a dollar.
  if (budget > 0 && startsSomewhere) {
    walkAwayDollars = Math.max(walkAwayDollars, Math.min(minBid, budget));
  }

  // ---- PRICE: the cheapest bid that reaches each goal ----------------------
  function bidForTarget(target: number): number | null {
    if (!winChanceAt || budget <= 0) return null;
    for (let dollars = Math.max(0, minBid); dollars <= budget; dollars += 1) {
      if (winChanceAt(dollars) >= target) return dollars;
    }
    return null;
  }

  const goalCfg = settings.goal;
  const benchOnly = marginal?.isBenchOnly === true;
  const nobodyElseBids = (input.noRivalShare ?? 0) >= 0.95;

  let valueDollars: number;
  let sureDollars: number;
  // The ceiling on the sure bid, kept in scope because the odd-number nudge
  // has to respect it too: nudging 60 to 61 past a cap of 60 would quietly
  // break the promise the copy makes about how far over worth it will go.
  let sureCap = budget;

  if (benchOnly || nobodyElseBids) {
    // He is insurance, or nobody else wants him. Either way the answer is the
    // smallest bid the league accepts, and paying more buys nothing at all.
    valueDollars = Math.min(minBid, budget);
    sureDollars = valueDollars;
  } else {
    const fromValue = bidForTarget(goalCfg.valueTarget);
    valueDollars = Math.min(fromValue ?? walkAwayDollars, walkAwayDollars);

    sureCap = Math.min(
      budget,
      Math.round(walkAwayDollars * (1 + goalCfg.sureMaxOverWorthPct / 100)),
    );
    const fromSure = bidForTarget(goalCfg.sureTarget);
    sureDollars = Math.min(fromSure ?? sureCap, sureCap);
    // The sure bid is never below the value bid: a higher target cannot buy
    // less, and an inversion would read as a broken calculator.
    sureDollars = Math.max(sureDollars, valueDollars);
  }

  // Odd numbers win ties, and ties on round numbers are common. One dollar is
  // the cheapest edge in FAAB.
  function oddNudge(dollars: number, cap: number): number {
    if (!settings.auction.oddNudge) return dollars;
    if (dollars < 10 || dollars % 5 !== 0) return dollars;
    return dollars + 1 <= cap ? dollars + 1 : dollars;
  }

  if (!benchOnly && !nobodyElseBids) {
    valueDollars = oddNudge(valueDollars, Math.min(walkAwayDollars, budget));
    sureDollars = oddNudge(sureDollars, Math.min(sureCap, budget));
  }

  const valueRung = rungFor(valueDollars, totalBudget, winChanceAt);
  const sureRung = rungFor(sureDollars, totalBudget, winChanceAt);
  const walkAwayRung = rungFor(walkAwayDollars, totalBudget, winChanceAt);

  const goal = input.goal;
  const bid = goal === "sure" ? sureRung : valueRung;
  const stretch =
    goal === "value" ? (sureRung.dollars > bid.dollars ? sureRung : walkAwayRung) : walkAwayRung;

  // "He will cost more than he is worth to you" is a real answer and one the
  // old ladder could only express by printing the same number three times.
  const priceAboveWorth =
    walkAwayRung.winChance !== null && walkAwayRung.winChance < goalCfg.valueTarget;

  // The curve, sampled once here so both modes carry the same thing and the
  // page never has to ask the server a second time to draw it.
  const winCurve: Array<{ dollars: number; winChance: number }> = [];
  if (winChanceAt && budget > 0) {
    const step = Math.max(1, Math.round(budget / 20));
    const marks = new Set<number>([0, valueDollars, sureDollars, walkAwayDollars, budget]);
    for (let dollars = 0; dollars <= budget; dollars += step) marks.add(dollars);
    for (const dollars of [...marks].sort((a, b) => a - b)) {
      if (dollars < 0 || dollars > budget) continue;
      winCurve.push({ dollars, winChance: clamp(winChanceAt(dollars), 0, 1) });
    }
  }

  const bidPctOfRemaining = budget > 0 ? (bid.dollars / budget) * 100 : 0;
  const aggressionLabel = aggressionFor(isDumpCandidate, bidPctOfRemaining);

  const { headline, explanation } = describe({
    marginal,
    market,
    isDumpCandidate,
    bid: bid.dollars,
    walkAway: walkAwayRung.dollars,
    upgradeStrength,
    priceAboveWorth,
    nobodyElseBids,
    goal,
    overWorth: Math.max(0, bid.dollars - walkAwayRung.dollars),
    choppedHeadline: input.choppedHeadline ?? null,
  });

  if (input.confidence === "low") notices.push(settings.copy.thinDataNote);

  return {
    ladder: {
      goal,
      bid,
      stretch,
      walkAway: walkAwayRung,
      priceAboveWorth,
      rivalTop: input.rivalTop ?? null,
      budgetAfterBid: Math.max(0, budget - bid.dollars),
      bidsByGoal: { value: valueRung, sure: sureRung },
      winCurve,
    },
    aggressionLabel,
    isDumpCandidate,
    headline,
    explanation,
    notices,
    upgradeStrength,
    worthPct,
    pointsWorthPct,
  };
}

/**
 * The words.
 *
 * Written to name the two or three things actually driving the number,
 * because a recommendation a reader cannot argue with is one they cannot
 * trust either.
 */
function describe({
  marginal,
  market,
  isDumpCandidate,
  bid,
  walkAway,
  upgradeStrength,
  priceAboveWorth,
  nobodyElseBids,
  goal,
  overWorth,
  choppedHeadline,
}: {
  marginal: MarginalValue | null;
  market: MarketRead;
  isDumpCandidate: boolean;
  bid: number;
  walkAway: number;
  upgradeStrength: number;
  priceAboveWorth: boolean;
  nobodyElseBids: boolean;
  goal: GoalKey;
  overWorth: number;
  choppedHeadline: string | null;
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

  if (nobodyElseBids) {
    parts.push(`Bid ${bid} and keep the rest. Nothing here says you need to spend more.`);
  } else if (goal === "sure" && overWorth > 0) {
    // This branch comes BEFORE the over-worth warning on purpose. The reader
    // asked to make sure of him, and we are recommending a number above his
    // worth; telling them in the same paragraph to bid the lower number
    // instead would contradict the figure at the top of the card.
    parts.push(
      `${bid} is ${overWorth} over his worth to you, which is the price of making sure. Drop to ${walkAway} if you would rather keep the money.`,
    );
  } else if (priceAboveWorth) {
    parts.push(
      `He is worth ${walkAway} to you and the room is likely to pay more than that. Bid ${walkAway} and let him go above it: there is no version of this where paying over his worth is the right move.`,
    );
  } else if (isDumpCandidate) {
    parts.push(`Spend. ${bid} gets it done; ${walkAway} is where even this stops being worth it.`);
  } else {
    parts.push(`${bid} should win him. Above ${walkAway} you are overpaying, and letting him go is the right move.`);
  }

  const headline = choppedHeadline
    ? choppedHeadline
    : nobodyElseBids
      ? "Nobody else needs him"
      : priceAboveWorth
        ? "He will likely cost more than he is worth to you"
        : isDumpCandidate
          ? "Empty the clip"
          : upgradeStrength >= 0.6
            ? "Priority add"
            : upgradeStrength >= 0.3
              ? "Worth a real bid"
              : "Cheap upgrade";

  return { headline, explanation: parts.join(" ") };
}
