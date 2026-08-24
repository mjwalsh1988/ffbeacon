/**
 * The answer, before the working.
 *
 * WHY THIS EXISTS
 * The evaluation opened on its reasons. Every one of them is true and useful and
 * none of them is the thing a reader came for, which is "should I take this".
 * They had to read four paragraphs and two tables and do the arithmetic
 * themselves. This computes the call, so the page can lead with it.
 *
 * IT IS A FUNCTION, NOT AN OPINION
 * Every field below comes from figures the model already produced, by rules
 * written out here in the open. Nothing is generated, nothing is weighted by
 * anything a reader cannot see, and `summary` names the measure that decided it
 * so the call can be argued with. That is the same standard the reason templates
 * hold themselves to, and for the same reason: a verdict a manager cannot check
 * is a verdict they should not trust.
 *
 * VALUE AND WINS ARE BOTH REPORTED, ALWAYS
 * They routinely disagree, and the disagreement is the whole point of the
 * module. A trade that adds value and costs wins is right for a rebuilder and
 * wrong for a contender, so the call leans on whichever one matches the team's
 * own direction and SAYS SO rather than averaging them into a number that
 * describes neither.
 *
 * Pure. No React, no database, no clock.
 */

import type { ImpactGaps, ResolvedAsset, TeamImpact } from "./types";

/**
 * Value margin under which the two sides are called even, as a percentage of
 * the combined package.
 *
 * 3 to match Signal Check's `signal_check_neutral_threshold`, so the two tools
 * cannot call the same trade even and not-even. Below this the gap is inside the
 * disagreement between any two value sources and is not worth a verdict.
 */
export const EVEN_MARGIN_PCT = 3;

/**
 * Margin at which one side is being run over. Also Signal Check's, also so the
 * two agree.
 */
export const LOPSIDED_MARGIN_PCT = 20;

/** Projected wins under which a change is noise. A tenth of a win is nothing. */
const WINS_NOISE = 0.15;

/** Playoff odds move, in percentage points, under which a change is noise. */
const PLAYOFF_NOISE_PP = 1;

/**
 * Points per week under which a lineup change is noise. Same bar the lineup
 * reason uses, so the headline cannot claim a gain the reasons decline to name.
 */
const LINEUP_NOISE = 0.5;

export type Favours = "you" | "them" | "even";

export type OutcomeCall =
  /** Both measures agree it is good for you. */
  | "take"
  /** One says good, the other is quiet, or the split favours your direction. */
  | "lean-yes"
  /** They disagree with nothing to break the tie, or nothing moved at all. */
  | "close"
  | "lean-no"
  | "decline";

export type TradeOutcome = {
  call: OutcomeCall;
  /** Two or three words. The thing to print largest on the page. */
  headline: string;
  /** One sentence naming the measure that decided it. Always checkable. */
  summary: string;

  /** Sum of what you receive, and what you send. */
  valueIn: number;
  valueOut: number;
  /** Your share of the combined package, 0..100. Segments of the balance bar. */
  yourShare: number;
  theirShare: number;
  /**
   * |yourShare - theirShare|. Signal Check's definition exactly
   * (|A-B| / (A+B)), so a trade cannot be 12% here and 30% there.
   */
  valueMarginPct: number;
  valueFavours: Favours;
  lopsided: boolean;

  /** Change in projected wins. Null when there is no season left to simulate. */
  winsDelta: number | null;
  /** Change in playoff odds, in percentage points. */
  playoffDeltaPp: number | null;
  /** Change in optimal starting lineup, points per week. */
  lineupDelta: number | null;
  /** Null when nothing about the season could be measured at all. */
  winsFavours: Favours | null;

  /**
   * True when value and wins point opposite ways. The single most useful thing
   * on the page when it happens, and the reason the call explains itself.
   */
  split: boolean;
};

function sum(assets: ResolvedAsset[]): number {
  return assets.reduce((total, asset) => total + asset.value, 0);
}

function favoursFromDelta(delta: number, noise: number): Favours {
  if (delta > noise) return "you";
  if (delta < -noise) return "them";
  return "even";
}

/** One decimal, signed, for prose. */
function signed(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : rounded < 0 ? "-" : ""}${Math.abs(rounded).toFixed(digits)}`;
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

/**
 * Which way the season moves.
 *
 * Projected wins first, because that is what the Performance panel leads with
 * and what a manager is actually playing for. Playoff odds second, because a
 * team already locked in or already out can gain wins without gaining anything.
 * The weekly lineup last, because it is the rawest of the three and the only one
 * that survives when there is no season left to simulate.
 *
 * Returns null only when NONE of the three could be measured, which is the
 * honest answer for a league with no projections and no games remaining.
 */
function readWins(
  winsDelta: number | null,
  playoffDeltaPp: number | null,
  lineupDelta: number | null,
): Favours | null {
  if (winsDelta !== null) {
    const call = favoursFromDelta(winsDelta, WINS_NOISE);
    if (call !== "even") return call;
  }
  if (playoffDeltaPp !== null) {
    const call = favoursFromDelta(playoffDeltaPp, PLAYOFF_NOISE_PP);
    if (call !== "even") return call;
  }
  if (lineupDelta !== null) {
    return favoursFromDelta(lineupDelta, LINEUP_NOISE);
  }
  // Every measure that existed said "no meaningful change". That is "even",
  // not "unknown", and the two must not be collapsed.
  if (winsDelta !== null || playoffDeltaPp !== null) return "even";
  return null;
}

const HEADLINE: Record<OutcomeCall, string> = {
  take: "Take this trade",
  "lean-yes": "Worth taking",
  close: "Too close to call",
  "lean-no": "Lean against it",
  decline: "Turn this one down",
};

/**
 * The sentence under the headline.
 *
 * Every branch names a figure that is printed somewhere on the same screen, so a
 * reader can check the call against the working rather than taking it on trust.
 */
function buildSummary(o: {
  call: OutcomeCall;
  split: boolean;
  valueFavours: Favours;
  valueMarginPct: number;
  winsFavours: Favours | null;
  winsDelta: number | null;
  playoffDeltaPp: number | null;
  lineupDelta: number | null;
  statusKey: TeamImpact["statusKey"];
  statusLabel: string | null;
}): string {
  const valuePart =
    o.valueFavours === "even"
      ? "The two sides are level on value"
      : o.valueFavours === "you"
        ? `You come out ${pct(o.valueMarginPct)} ahead on value`
        : `You give up ${pct(o.valueMarginPct)} more value than you get back`;

  const winsPart =
    o.winsFavours === null
      ? null
      : o.winsDelta !== null && Math.abs(o.winsDelta) >= WINS_NOISE
        ? `${signed(o.winsDelta)} projected wins`
        : o.playoffDeltaPp !== null && Math.abs(o.playoffDeltaPp) >= PLAYOFF_NOISE_PP
          ? `${signed(o.playoffDeltaPp, 0)} points of playoff odds`
          : o.lineupDelta !== null && Math.abs(o.lineupDelta) >= LINEUP_NOISE
            ? `${signed(o.lineupDelta)} points a week in your lineup`
            : "no measurable change to your season";

  if (o.split) {
    const direction =
      o.statusKey === "competitor"
        ? "You are built to win now, so the lineup is the half that counts"
        : o.statusKey === "rebuilder"
          ? "You are not winning now, so the value is the half that counts"
          : "Neither half outweighs the other for a team in the middle";
    return `${valuePart}, and it is worth ${winsPart} to you. ${direction}.`;
  }

  if (winsPart === null) {
    return `${valuePart}. There is no season left to measure, so value is the whole answer.`;
  }
  return `${valuePart}, and it is worth ${winsPart} to you.`;
}

/**
 * Turn two agreeing or disagreeing measures into one call.
 *
 * A split is broken by the team's own direction, which is the same rule the
 * direction reason uses: a contender is judged on the lineup and a rebuilder on
 * the value, because those are the two different things they are playing for. A
 * team in the middle gets no tiebreak, because the classifier declined to say
 * which way it is pointing and inventing one here would be a claim the rest of
 * the page does not make.
 */
function decide(
  valueFavours: Favours,
  winsFavours: Favours | null,
  statusKey: TeamImpact["statusKey"],
): { call: OutcomeCall; split: boolean } {
  // Nothing about the season could be measured. Value is the whole answer.
  if (winsFavours === null) {
    if (valueFavours === "you") return { call: "lean-yes", split: false };
    if (valueFavours === "them") return { call: "lean-no", split: false };
    return { call: "close", split: false };
  }

  if (valueFavours === winsFavours) {
    if (valueFavours === "you") return { call: "take", split: false };
    if (valueFavours === "them") return { call: "decline", split: false };
    return { call: "close", split: false };
  }

  // One is quiet. The one that spoke decides, but only to a lean.
  if (valueFavours === "even" || winsFavours === "even") {
    const speaking = valueFavours === "even" ? winsFavours : valueFavours;
    return { call: speaking === "you" ? "lean-yes" : "lean-no", split: false };
  }

  // A genuine split.
  const decider: Favours | null =
    statusKey === "competitor"
      ? winsFavours
      : statusKey === "rebuilder"
        ? valueFavours
        : null;
  if (decider === null) return { call: "close", split: true };
  return { call: decider === "you" ? "lean-yes" : "lean-no", split: true };
}

export function buildTradeOutcome(
  mine: TeamImpact,
  gaps: ImpactGaps,
): TradeOutcome {
  const valueIn = sum(mine.incoming);
  const valueOut = sum(mine.outgoing);
  const combined = valueIn + valueOut;

  // An empty or valueless package splits the bar evenly rather than dividing by
  // zero. A league with no pick values can genuinely produce this.
  const yourShare = combined > 0 ? (valueIn / combined) * 100 : 50;
  const theirShare = 100 - yourShare;
  const valueMarginPct = Math.abs(yourShare - theirShare);

  const valueFavours: Favours =
    combined === 0 || valueMarginPct < EVEN_MARGIN_PCT
      ? "even"
      : valueIn > valueOut
        ? "you"
        : "them";

  const winsDelta =
    gaps.simulation ||
    mine.projectedWinsBefore === null ||
    mine.projectedWinsAfter === null
      ? null
      : mine.projectedWinsAfter - mine.projectedWinsBefore;

  const playoffDeltaPp =
    gaps.simulation || mine.playoffOddsBefore === null || mine.playoffOddsAfter === null
      ? null
      : (mine.playoffOddsAfter - mine.playoffOddsBefore) * 100;

  const lineupDelta = gaps.lineup ? null : mine.lineupDelta;

  const winsFavours = readWins(winsDelta, playoffDeltaPp, lineupDelta);
  const { call, split } = decide(valueFavours, winsFavours, mine.statusKey);

  return {
    call,
    headline: HEADLINE[call],
    summary: buildSummary({
      call,
      split,
      valueFavours,
      valueMarginPct,
      winsFavours,
      winsDelta,
      playoffDeltaPp,
      lineupDelta,
      statusKey: mine.statusKey,
      statusLabel: mine.statusLabel,
    }),
    valueIn,
    valueOut,
    yourShare,
    theirShare,
    valueMarginPct,
    valueFavours,
    lopsided: valueMarginPct >= LOPSIDED_MARGIN_PCT,
    winsDelta,
    playoffDeltaPp,
    lineupDelta,
    winsFavours,
    split,
  };
}
