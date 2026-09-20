/**
 * The shape the result card renders, and the small pure helpers every part of
 * it shares.
 *
 * Both modes render the same card, so both build one of these. What changes
 * between them is what the figures MEAN, not how they are laid out: league
 * mode measures against your actual lineup, manual mode against the best
 * player you could already start. The mode is stated on the card rather than
 * left implied.
 *
 * WHY THE GOAL IS NOT IN HERE. The reader can switch between "good value" and
 * "make sure I win" at any moment, and that switch must not cost a server
 * call. `BidLadder.bidsByGoal` carries both answers, so the switch is the
 * arithmetic in `rungsForGoal` and nothing else. The goal itself is state on
 * whichever parent owns the live region, because the announcement and the
 * number have to move together.
 *
 * Pure. No React, no imports beyond types, so the copy text, the spoken
 * message and the share link can all be tested or reused anywhere.
 */

import type {
  BidLadder,
  BidRung,
  ChoppedRead,
  FaabConfidence,
  FaabSignal,
  GoalKey,
  InjuredStarter,
  LeagueFaabReport,
  LeagueKind,
  MarginalValue,
  MarketRead,
  RivalRow,
} from "@/lib/faab/types";

/**
 * One priced point on the win curve.
 *
 * The curve itself lives on the ladder (`BidLadder.winCurve`), built in
 * lib/faab/ladder.ts so both modes get the same sampling from the same code.
 * An empty curve means nothing could price the bid, and the chart does not
 * draw.
 */
export type CurvePoint = BidLadder["winCurve"][number];

export type BidView = {
  mode: "league" | "manual";
  leagueKind: LeagueKind;
  /** The player's name. Rendered as the card's h3. */
  title: string;
  /** Sits under the title: the league and week, or the league shape. */
  subtitle: string;
  headline: string;
  explanation: string;
  confidence: FaabConfidence;
  ladder: BidLadder;
  /** Which goal the card opens on. Chopped danger can flip it. */
  goalDefault: GoalKey;
  isDumpCandidate: boolean;
  marginal: MarginalValue | null;
  signals: FaabSignal[];
  /** Null in manual mode: without a league there is no competition to read. */
  market: MarketRead | null;
  notices: string[];
  /** Manual mode only: the player replacement level was measured against. */
  replacement: { rank: number; pointsPerWeek: number } | null;
  availability?: LeagueFaabReport["availability"];
  rosteredBy?: string | null;
  /** One line each, every one citing a figure elsewhere on this card. */
  reasons: string[];
  rivals: RivalRow[];
  rivalsNotInterested: number;
  injuredStarters: InjuredStarter[];
  positionalWar: LeagueFaabReport["positionalWar"];
  chopped: ChoppedRead | null;
  heat: { value: number; samples: number } | null;
  priorsFallback: string | null;
  /** What the reader has left to spend. */
  remainingBudget: number;
  /** The league's full starting allowance. Every share is measured against it. */
  totalBudget: number;
  /** Sleeper id, for the share image. Null when we hold none. */
  sleeperId: string | null;
};

export const CONFIDENCE_LABEL: Record<FaabConfidence, string> = {
  high: "Strong read",
  medium: "Reasonable read",
  low: "Thin read",
};

export const GOAL_LABEL: Record<GoalKey, string> = {
  value: "Good value",
  sure: "Make sure I win",
};

/** The three numbers for one goal, and what is left afterwards. */
export type GoalRungs = {
  bid: BidRung;
  stretch: BidRung;
  walkAway: BidRung;
  budgetAfterBid: number;
};

/**
 * The ladder, read for whichever goal the reader picked.
 *
 * The server already priced both, so this is arithmetic and never a fetch.
 * The stretch rung follows the same rule the server applies: for the value
 * goal it is the sure bid when that is higher, otherwise the walk-away; for
 * the sure goal it is always the walk-away.
 */
export function rungsForGoal(
  ladder: BidLadder,
  goal: GoalKey,
  remainingBudget: number,
): GoalRungs {
  const bid = goal === "sure" ? ladder.bidsByGoal.sure : ladder.bidsByGoal.value;
  const stretch =
    goal === "value"
      ? ladder.bidsByGoal.sure.dollars > bid.dollars
        ? ladder.bidsByGoal.sure
        : ladder.walkAway
      : ladder.walkAway;
  return {
    bid,
    stretch,
    walkAway: ladder.walkAway,
    budgetAfterBid: Math.max(0, Math.round(remainingBudget) - bid.dollars),
  };
}

/** A win chance as a whole percent, or null when we could not price one. */
export function winPercent(rung: BidRung): number | null {
  return rung.winChance === null ? null : Math.round(rung.winChance * 100);
}

/** A 0 to 1 probability as a whole percent. */
export function asPercent(probability: number): number {
  return Math.round(probability * 100);
}

/**
 * The two figures the `faab_result` event reports, from one place so the two
 * modes cannot measure them differently.
 *
 * `bid_pct` is a share of the league's FULL budget, which is the only figure
 * comparable between a 100 league and a 1,000 one, and it is the rung's own
 * `pct` rounded to a tenth so the payload does not carry float noise.
 *
 * `win_chance` reports 0 when the bid could not be priced at all. The
 * parameter is a number and cannot carry "we do not know", so read a 0
 * alongside the rest of the event rather than as a measured certainty.
 */
export function analyticsBid(
  ladder: BidLadder,
  goal: GoalKey,
): { bid_pct: number; win_chance: number } {
  const rung = goal === "sure" ? ladder.bidsByGoal.sure : ladder.bidsByGoal.value;
  return {
    bid_pct: Math.round(rung.pct * 10) / 10,
    win_chance: rung.winChance === null ? 0 : Math.round(rung.winChance * 100),
  };
}

/**
 * What the polite live region says when a result lands or the goal changes.
 *
 * One sentence, the three numbers in the order a reader acts on them, and the
 * chopped clause only in a chopped league.
 */
export function liveMessage(view: BidView, goal: GoalKey): string {
  const rungs = rungsForGoal(view.ladder, goal, view.remainingBudget);
  const win = winPercent(rungs.bid);
  const parts = [
    `${view.headline}. Bid ${rungs.bid.dollars} FAAB`,
    win === null ? null : `${win} percent chance to win`,
    `walk away above ${rungs.walkAway.dollars}`,
  ].filter((part): part is string => part !== null);
  let message = parts.join(", ");
  if (view.chopped) {
    message += `, chance of being chopped this week ${asPercent(view.chopped.after.pChoppedThisWeek)} percent`;
  }
  return `${message}.`;
}

/**
 * The text the Copy bid button writes, in the exact format the plan sets.
 *
 * The win chance clause is dropped rather than faked when we could not price
 * one. A pasted "(0% to win)" would be read as a measured figure.
 */
export function copyText(view: BidView, goal: GoalKey): string {
  const rungs = rungsForGoal(view.ladder, goal, view.remainingBudget);
  const win = winPercent(rungs.bid);
  const chance = win === null ? "" : ` (${win}% to win)`;
  return `FAAB: bid ${rungs.bid.dollars} of ${Math.round(view.remainingBudget)} on ${view.title}${chance}. Walk away above ${rungs.walkAway.dollars}. ffbeacon.com/tools/faab`;
}

/**
 * The share card's URL, or null when we cannot address one.
 *
 * The route refuses anything out of range rather than clamping it, so a view
 * without a Sleeper id or without a priced win chance gets no button at all.
 */
export function shareImageHref(view: BidView, goal: GoalKey): string | null {
  if (!view.sleeperId) return null;
  const rungs = rungsForGoal(view.ladder, goal, view.remainingBudget);
  const win = winPercent(rungs.bid);
  if (win === null) return null;
  const query = new URLSearchParams({
    p: view.sleeperId,
    bid: String(rungs.bid.dollars),
    walk: String(rungs.walkAway.dollars),
    budget: String(Math.round(view.totalBudget)),
    win: String(win),
    k: view.leagueKind === "chopped" ? "chopped" : "standard",
  });
  return `/api/og/faab?${query.toString()}`;
}
