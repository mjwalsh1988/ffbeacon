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

import { isPriced, type ImpactGaps, type ResolvedAsset, type TeamImpact } from "./types";
import {
  EVEN_MARGIN_PCT,
  LOPSIDED_MARGIN_PCT,
  valueMarginOf,
} from "@/lib/trade-finder/value-margin";
import type { TradeLeagueKind, TradeStrategy } from "@/lib/trade-finder/types";

/**
 * The value thresholds, Signal Check's, from the shared value helper so the
 * card, this call and Signal Check cannot disagree about "even".
 */
export { EVEN_MARGIN_PCT, LOPSIDED_MARGIN_PCT };

/** Survival odds move, in percentage points, under which a change is noise. */
const SURVIVAL_NOISE_PP = 1;

/** Projected wins under which a change is noise. A tenth of a win is nothing. */
const WINS_NOISE = 0.15;

/** Playoff odds move, in percentage points, under which a change is noise. */
const PLAYOFF_NOISE_PP = 1;

/**
 * Points per week under which a lineup change is noise. Same bar the lineup
 * reason uses, so the headline cannot claim a gain the reasons decline to name.
 */
const LINEUP_NOISE = 0.5;

export type Favors = "you" | "them" | "even";

export type OutcomeCall =
  /** Both measures agree it is good for you. */
  | "take"
  /** One says good, the other is quiet, or the split favors your direction. */
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
  valueFavors: Favors;
  lopsided: boolean;

  /** Change in projected wins. Null when there is no season left to simulate. */
  winsDelta: number | null;
  /** Change in playoff odds, in percentage points. */
  playoffDeltaPp: number | null;
  /** Change in title odds, in percentage points. */
  titleDeltaPp: number | null;
  /** Chopped only: change in this week's survival odds, in percentage points. */
  survivalDeltaPp: number | null;
  /**
   * Which measure the call leans on. "wins" for redraft, chopped and dynasty
   * Compete; "value" for dynasty Rebuild; "both" when no mode was given and the
   * team's own standing breaks a split, the call this module made before modes.
   */
  lens: "wins" | "value" | "both";
  /** True when an unpriced asset is in the deal, so the call rests on wins. */
  hasUnpriced: boolean;
  /** Change in optimal starting lineup, points per week. */
  lineupDelta: number | null;
  /** Null when nothing about the season could be measured at all. */
  winsFavors: Favors | null;

  /**
   * True when value and wins point opposite ways. The single most useful thing
   * on the page when it happens, and the reason the call explains itself.
   */
  split: boolean;
};

function favorsFromDelta(delta: number, noise: number): Favors {
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

/** "3 percentage points", "1 percentage point", signed in words. */
function points(pp: number): string {
  const n = Math.abs(Math.round(pp));
  return `${n} percentage ${n === 1 ? "point" : "points"}`;
}

/**
 * Which way the season moves.
 *
 * Chopped survival first when there is one, because surviving this week is
 * the whole season in that format. Then projected wins, because that is what
 * the Performance panel leads with and what a manager is actually playing for.
 * Playoff odds next, because a team already locked in or already out can gain
 * wins without gaining anything. The weekly lineup last, because it is the
 * rawest and the only one that survives when there is no season left.
 *
 * Returns null only when NONE could be measured, which is the honest answer for
 * a league with no projections and no games remaining.
 */
function readWins(
  survivalDeltaPp: number | null,
  winsDelta: number | null,
  playoffDeltaPp: number | null,
  lineupDelta: number | null,
): Favors | null {
  if (survivalDeltaPp !== null) {
    const call = favorsFromDelta(survivalDeltaPp, SURVIVAL_NOISE_PP);
    if (call !== "even") return call;
  }
  if (winsDelta !== null) {
    const call = favorsFromDelta(winsDelta, WINS_NOISE);
    if (call !== "even") return call;
  }
  if (playoffDeltaPp !== null) {
    const call = favorsFromDelta(playoffDeltaPp, PLAYOFF_NOISE_PP);
    if (call !== "even") return call;
  }
  if (lineupDelta !== null) {
    return favorsFromDelta(lineupDelta, LINEUP_NOISE);
  }
  // Every measure that existed said "no meaningful change". That is "even",
  // not "unknown", and the two must not be collapsed.
  if (survivalDeltaPp !== null || winsDelta !== null || playoffDeltaPp !== null) return "even";
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
 * One sentence, naming the figure the call leaned on. Every figure is printed
 * somewhere on the same screen, so the call can be checked against the working.
 */
function buildSummary(o: {
  lens: TradeOutcome["lens"];
  split: boolean;
  hasUnpriced: boolean;
  valueFavors: Favors;
  valueMarginPct: number;
  winsFavors: Favors | null;
  survivalDeltaPp: number | null;
  winsDelta: number | null;
  playoffDeltaPp: number | null;
  lineupDelta: number | null;
  statusKey: TeamImpact["statusKey"];
}): string {
  const valuePart =
    o.valueFavors === "even"
      ? "the two sides are level on value"
      : o.valueFavors === "you"
        ? `you come out ${pct(o.valueMarginPct)} ahead on value`
        : `you give up ${pct(o.valueMarginPct)} more value than you get back`;

  const winsPart =
    o.winsFavors === null
      ? null
      : o.survivalDeltaPp !== null && Math.abs(o.survivalDeltaPp) >= SURVIVAL_NOISE_PP
        ? `${o.survivalDeltaPp > 0 ? "raises" : "lowers"} your odds of surviving this week by ${points(o.survivalDeltaPp)}`
        : o.winsDelta !== null && Math.abs(o.winsDelta) >= WINS_NOISE
          ? `is worth ${signed(o.winsDelta)} projected wins`
          : o.playoffDeltaPp !== null && Math.abs(o.playoffDeltaPp) >= PLAYOFF_NOISE_PP
            ? `moves your playoff odds ${o.playoffDeltaPp > 0 ? "up" : "down"} ${points(o.playoffDeltaPp)}`
            : o.lineupDelta !== null && Math.abs(o.lineupDelta) >= LINEUP_NOISE
              ? `changes your lineup by ${signed(o.lineupDelta)} points a week`
              : "makes no measurable change to your season";

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  if (winsPart === null) {
    return `${cap(valuePart)}, and there is no season left to measure.`;
  }
  if (o.hasUnpriced) {
    return `It ${winsPart}, and the call rests on that because part of the deal has no market value.`;
  }
  if (o.lens === "wins") {
    return `It ${winsPart}, and ${valuePart}.`;
  }
  if (o.lens === "value") {
    return `${cap(valuePart)}, and it ${winsPart}.`;
  }
  if (o.split) {
    const direction =
      o.statusKey === "competitor"
        ? "you are built to win now, so the lineup is the half that counts"
        : o.statusKey === "rebuilder"
          ? "you are not winning now, so the value is the half that counts"
          : "neither half outweighs the other";
    return `${cap(valuePart)} and it ${winsPart}, but ${direction}.`;
  }
  return `${cap(valuePart)}, and it ${winsPart}.`;
}

/**
 * Turn two measures into one call, leaning on the one the league kind and the
 * reader's mode say counts.
 *
 *   "wins"  redraft, chopped, dynasty Compete, and any deal holding an unpriced
 *           asset. The season figure decides; value can soften the call one
 *           step but never flip it.
 *   "value" dynasty Rebuild. The mirror image.
 *   "both"  no mode given. A split is broken by the team's own standing, the
 *           rule this module used before modes existed.
 */
function decide(
  valueFavors: Favors,
  winsFavors: Favors | null,
  lens: TradeOutcome["lens"],
  statusKey: TeamImpact["statusKey"],
): { call: OutcomeCall; split: boolean } {
  // Nothing about the season could be measured. Value is the whole answer.
  if (winsFavors === null) {
    if (valueFavors === "you") return { call: "lean-yes", split: false };
    if (valueFavors === "them") return { call: "lean-no", split: false };
    return { call: "close", split: false };
  }

  const split =
    (valueFavors === "you" && winsFavors === "them") ||
    (valueFavors === "them" && winsFavors === "you");

  if (lens !== "both") {
    const lead = lens === "wins" ? winsFavors : valueFavors;
    const other = lens === "wins" ? valueFavors : winsFavors;
    if (lead === "you") return { call: other === "them" ? "lean-yes" : "take", split };
    if (lead === "them") return { call: other === "you" ? "lean-no" : "decline", split };
    // The lead measure is flat: the other one may lean the call, nothing more.
    if (other === "you") return { call: "lean-yes", split: false };
    if (other === "them") return { call: "lean-no", split: false };
    return { call: "close", split: false };
  }

  if (valueFavors === winsFavors) {
    if (valueFavors === "you") return { call: "take", split: false };
    if (valueFavors === "them") return { call: "decline", split: false };
    return { call: "close", split: false };
  }

  // One is quiet. The one that spoke decides, but only to a lean.
  if (valueFavors === "even" || winsFavors === "even") {
    const speaking = valueFavors === "even" ? winsFavors : valueFavors;
    return { call: speaking === "you" ? "lean-yes" : "lean-no", split: false };
  }

  // A genuine split.
  const decider: Favors | null =
    statusKey === "competitor"
      ? winsFavors
      : statusKey === "rebuilder"
        ? valueFavors
        : null;
  if (decider === null) return { call: "close", split: true };
  return { call: decider === "you" ? "lean-yes" : "lean-no", split: true };
}

/**
 * The call for one trade.
 *
 * `opts.value` is the consolidated value from the evaluation (priced assets
 * only, after the Signal Check adjustment). Without it the raw sums of the
 * priced assets are used. `opts.leagueKind` and `opts.strategy` pick the lens;
 * without them the call reads the team's standing as it always did.
 */
export function buildTradeOutcome(
  mine: TeamImpact,
  gaps: ImpactGaps,
  opts: {
    leagueKind?: TradeLeagueKind;
    strategy?: TradeStrategy;
    value?: { valueIn: number; valueOut: number };
  } = {},
): TradeOutcome {
  const priced = (assets: ResolvedAsset[]) =>
    assets.filter(isPriced).reduce((total, a) => total + a.value, 0);
  const hasUnpriced = [...mine.incoming, ...mine.outgoing].some((a) => !isPriced(a));
  const valueIn = opts.value?.valueIn ?? priced(mine.incoming);
  const valueOut = opts.value?.valueOut ?? priced(mine.outgoing);
  const margin = valueMarginOf(valueIn, valueOut);

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

  const titleDeltaPp =
    gaps.simulation || mine.titleOddsBefore === null || mine.titleOddsAfter === null
      ? null
      : (mine.titleOddsAfter - mine.titleOddsBefore) * 100;

  const survivalDeltaPp =
    typeof mine.survivalBefore === "number" && typeof mine.survivalAfter === "number"
      ? (mine.survivalAfter - mine.survivalBefore) * 100
      : null;

  const lineupDelta = gaps.lineup ? null : mine.lineupDelta;

  const winsFavors = readWins(survivalDeltaPp, winsDelta, playoffDeltaPp, lineupDelta);

  const lens: TradeOutcome["lens"] =
    hasUnpriced && winsFavors !== null
      ? "wins"
      : opts.leagueKind === "redraft" || opts.leagueKind === "chopped"
        ? "wins"
        : opts.strategy === "contender"
          ? "wins"
          : opts.strategy === "value"
            ? "value"
            : "both";

  // An unpriced piece leaves the value half incomplete, so it does not vote.
  const valueFavors: Favors = hasUnpriced && winsFavors !== null ? "even" : margin.favors;
  const { call, split } = decide(valueFavors, winsFavors, lens, mine.statusKey);

  return {
    call,
    headline: HEADLINE[call],
    summary: buildSummary({
      lens,
      split,
      hasUnpriced: hasUnpriced && winsFavors !== null,
      valueFavors: margin.favors,
      valueMarginPct: margin.marginPct,
      winsFavors,
      survivalDeltaPp,
      winsDelta,
      playoffDeltaPp,
      lineupDelta,
      statusKey: mine.statusKey,
    }),
    valueIn,
    valueOut,
    yourShare: margin.yourShare,
    theirShare: 100 - margin.yourShare,
    valueMarginPct: margin.marginPct,
    valueFavors: margin.favors,
    lopsided: margin.lopsided,
    winsDelta,
    playoffDeltaPp,
    titleDeltaPp,
    survivalDeltaPp,
    lens,
    hasUnpriced,
    lineupDelta,
    winsFavors,
    split,
  };
}
