/**
 * What a deal does to each side, and whether it is worth putting in front of
 * anyone.
 *
 * Two numbers carry this feature, and they answer different questions:
 *
 *   VALUE says who wins the trade on paper. It is what every other trade tool
 *   reports, and on its own it is not advice: a perfectly balanced trade that
 *   leaves your lineup exactly as it was is a fair deal and a waste of a text
 *   message.
 *
 *   LINEUP says what the trade does to your Sunday. It is measured by refilling
 *   the optimal starting lineup on the roster you would have afterwards and
 *   subtracting the one you have now, which is the same fill Power Pulse uses,
 *   so a flex-heavy roster and a superflex league are both handled by the code
 *   that already knows how.
 *
 * A suggestion has to be good on the reader's side and survivable on the other
 * one. The acceptance band is that second test, and it is intentionally the
 * harsher of the two: the failure this feature has to avoid is not missing a
 * clever trade, it is sending someone to their league chat with an offer that
 * makes them look like they cannot read a roster.
 *
 * Pure. The lineup refills are the only real cost, and they run over
 * roster-sized candidate lists.
 */

import {
  DEFAULT_TRADE_QUALITY_CONFIG,
  qualityBalance,
  type TradeQualityConfig,
} from "@/lib/trade-quality";
import { lineupTotal } from "./profile";
import type { TeamProfile } from "./profile";
import { assetValue, type AssetRef } from "./packages";
import { winsDeltaFor } from "./pulse";
import type {
  AcceptanceBand,
  FinderPlayer,
  SideImpact,
  TeamDirection,
  TradeGoal,
} from "./types";

/** Below this share of the larger side, the two sides read as even. */
const EVEN_GAP = 0.08;
/**
 * Above this, one side is being asked to eat a loss they can see from space.
 *
 * Raised from 20%. Twenty percent of a mid-tier receiver is inside the spread
 * between two published value sources on the same player, and calling every deal
 * past it a long shot was quietly deciding, on the reader's behalf, that most of
 * their league would refuse to talk. It also compounded: a long shot is scored
 * at a fraction of its worth, so a band set too tight does not merely mislabel
 * deals, it removes them from the top of the ranking entirely.
 */
const LOPSIDED_GAP = 0.26;
/**
 * How big a value gap has to be before losing points off the lineup as well is
 * fatal to a deal's chances.
 *
 * Two bad things together used to be an automatic long shot however small either
 * one was, which caught the ordinary trade where a contender gives up a fraction
 * of a point in the flex to fix a real hole somewhere else. It is fatal when the
 * other manager can SEE both, so the value side now has to be visible first.
 */
const VISIBLE_LOSS_GAP = 0.1;
/**
 * A lineup loss this size is its own argument for refusing, whatever the value
 * column says.
 *
 * Twice the "this is a real subtraction" bar. Half a starting flex is a cost a
 * contender might absorb for the right piece; three points a week is most of a
 * starter, and a team chasing January turns that down on a level deal without
 * reading the rest of the offer.
 */
const SEVERE_LINEUP_LOSS = 3;
/**
 * Points per week a team has to lose off its starting lineup before the trade
 * is a real subtraction rather than a rounding error.
 */
const HURTS_LINEUP = 1.5;
/**
 * Years a roster's value-weighted age has to fall before "it makes them
 * younger" is an argument rather than noise.
 *
 * Measured against production: a swap of two similar players routinely moves a
 * roster's mean age by a tenth of a year, which is not a reason for anybody to
 * accept anything. Four tenths is the point at which the shape of the roster has
 * actually changed.
 */
const MEANINGFULLY_YOUNGER = 0.4;

/** The roster this team would hold after the deal. */
function rosterAfter(
  profile: TeamProfile,
  incoming: AssetRef[],
  outgoing: AssetRef[],
): FinderPlayer[] {
  const gone = new Set(
    outgoing.filter((a) => a.kind === "player").map((a) => a.player.playerId),
  );
  const kept = profile.team.players.filter((p) => !gone.has(p.playerId));
  const added = incoming
    .filter((a): a is Extract<AssetRef, { kind: "player" }> => a.kind === "player")
    .map((a) => a.player);
  return [...kept, ...added];
}

function weightedMeanAge(players: FinderPlayer[]): number | null {
  let weighted = 0;
  let weight = 0;
  for (const p of players) {
    if (p.age === null || !p.hasValue || p.value <= 0) continue;
    weighted += p.age * p.value;
    weight += p.value;
  }
  return weight > 0 ? weighted / weight : null;
}

function countPicks(assets: AssetRef[]): number {
  return assets.filter((a) => a.kind === "pick").length;
}

/**
 * What this deal does to one team.
 *
 * `lineupDelta` stays null when the league has no projections at all, rather
 * than reporting a zero. Zero means "this trade does not change your lineup",
 * which is a real and useful answer, and it must not be confused with "we could
 * not work out what it does".
 */
export function measureImpact(
  profile: TeamProfile,
  slots: string[],
  incoming: AssetRef[],
  outgoing: AssetRef[],
): SideImpact {
  const after = rosterAfter(profile, incoming, outgoing);
  const afterTotal = lineupTotal(slots, after);
  const beforeAge = profile.meanAge;
  const afterAge = weightedMeanAge(after);

  const lineupDelta =
    profile.startingTotal === null || afterTotal === null
      ? null
      : afterTotal - profile.startingTotal;

  return {
    valueDelta:
      incoming.reduce((s, a) => s + assetValue(a), 0) -
      outgoing.reduce((s, a) => s + assetValue(a), 0),
    lineupDelta,
    // Points per week turned into games, against THIS team's own remaining
    // schedule. Two points a week is worth a different number of wins to a team
    // with ten coin-flips left than to one with three games it has already all
    // but won, and that difference is the whole reason the reader is asking.
    winsDelta: winsDeltaFor(lineupDelta, profile.team.pulse),
    ageDelta: beforeAge === null || afterAge === null ? null : afterAge - beforeAge,
    pickCountDelta: countPicks(incoming) - countPicks(outgoing),
  };
}

/** The gap between the sides, as a share of the larger one. 0 is a dead heat. */
export function valueGapOf(incoming: AssetRef[], outgoing: AssetRef[]): number {
  const inValue = incoming.reduce((s, a) => s + assetValue(a), 0);
  const outValue = outgoing.reduce((s, a) => s + assetValue(a), 0);
  const larger = Math.max(inValue, outValue);
  if (larger <= 0) return 1;
  return Math.abs(inValue - outValue) / larger;
}

/**
 * What the outgoing package is worth against the incoming one, on the same
 * consolidation curve Signal Check grades with. 1 is level.
 *
 * The raw gap above cannot see the difference between paying with one starter
 * and paying with three bench pieces that add to the same number. This can, and
 * it is what the acceptance band reads, because the other manager can see it
 * too.
 */
export function qualityRatioOf(
  incoming: AssetRef[],
  outgoing: AssetRef[],
  quality?: { config: TradeQualityConfig; poolMax: number | null } | null,
): number {
  const config = quality?.config ?? DEFAULT_TRADE_QUALITY_CONFIG;
  const poolMax = quality?.poolMax ?? null;
  return qualityBalance(incoming.map(assetValue), outgoing.map(assetValue), poolMax, config).ratio;
}

/**
 * The quality gap, expressed exactly like valueGapOf (a share of the larger
 * side) so the acceptance thresholds mean the same thing on either measure.
 */
export function qualityGapOf(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return ratio < 1 ? 1 - ratio : 1 - 1 / ratio;
}

/**
 * Would the other manager engage with this?
 *
 * Three things decide it, in order of how loudly a real person would react:
 *
 *   Are they losing value, and how much. Nobody accepts a deal they can see is
 *   bad, however well it fits their timeline.
 *
 *   Does it move them the way they are already going. A rebuilding team taking
 *   on picks and youth is being handed what it wants; the same team taking on a
 *   30-year-old for the same value is being handed a problem.
 *
 *   Does it help them on the field. For a contender this outranks the timeline
 *   test, because their timeline IS this season.
 *
 * The bands are deliberately coarse. A percentage would be a made-up number
 * about a person we have never met, and a manager who reads "72% likely" and
 * gets turned down has been lied to. "Worth asking" is honest about what this
 * is: an offer with the arithmetic already done.
 */
export function acceptanceOf(
  theirs: SideImpact,
  profile: TeamProfile,
  gap: number,
  qualityRatio?: number,
): AcceptanceBand {
  /**
   * Read on the consolidation curve when we have it, on raw value when we do
   * not. The distinction is the point: a three-for-one that balances on paper
   * hands the other manager three roster spots for one, and reading it as "even"
   * is how this feature used to send people into their league chat with an offer
   * that has an obvious answer.
   *
   * `qualityRatio` is what the counterparty RECEIVES over what they give, which
   * is the same number from either seat, so no sign flip is needed here.
   */
  const haveQuality = typeof qualityRatio === "number" && Number.isFinite(qualityRatio);
  const losingValue = haveQuality ? qualityRatio < 1 : theirs.valueDelta < 0;
  const effectiveGap = haveQuality ? qualityGapOf(qualityRatio) : gap;

  const bigLoss = losingValue && effectiveGap > LOPSIDED_GAP;
  if (bigLoss) return "long-shot";

  const helpsLineup = (theirs.lineupDelta ?? 0) > 0.5;

  /**
   * Does losing points this week actually cost this team anything?
   *
   * Not if they are rebuilding. Sending a 27-year-old back away for a pick and a
   * 22-year-old costs a rebuilder real points on Sunday, and that is not a side
   * effect of the deal, it IS the deal: the most standard trade in dynasty
   * football. An earlier version applied the lineup penalty to everyone, and it
   * labelled exactly that trade a long shot against a real league, which is how
   * this was found.
   *
   * A contender is the opposite case. Their timeline is this season, so points
   * off the starting lineup are the whole cost.
   */
  const lineupMatters = profile.direction !== "rebuild";
  const hurtsLineup = lineupMatters && (theirs.lineupDelta ?? 0) < -HURTS_LINEUP;
  const guttedLineup = lineupMatters && (theirs.lineupDelta ?? 0) < -SEVERE_LINEUP_LOSS;

  // Worse off on the field AND worse off on paper, for a team that cares about
  // the field. Whatever else the deal does for their timeline, there is nothing
  // here to say yes to, and calling it "worth asking" would send somebody to
  // their league chat with an offer that has no argument behind it.
  //
  // Two bars rather than one. A lineup loss of this size refuses itself and the
  // value column does not get a vote. Below it, the value side has to be a gap
  // they can actually see before the pair is fatal: a level deal that costs a
  // contender half a point in the flex to fix a hole elsewhere is an ordinary
  // trade, and treating it as a long shot was quietly deleting most of the
  // realistic deals in any league where somebody is competing.
  if (losingValue && guttedLineup) return "long-shot";
  if (losingValue && hurtsLineup && effectiveGap > VISIBLE_LOSS_GAP) return "long-shot";

  const younger = (theirs.ageDelta ?? 0) < -MEANINGFULLY_YOUNGER;
  const gainsPicks = theirs.pickCountDelta > 0;

  let fits = false;
  if (profile.direction === "rebuild") fits = gainsPicks || younger;
  else if (profile.direction === "win-now") fits = helpsLineup;
  else fits = helpsLineup || gainsPicks || younger;

  const evenOrBetter = !losingValue || effectiveGap <= EVEN_GAP;

  if (fits && evenOrBetter && !hurtsLineup) return "likely";
  if (fits || evenOrBetter) return "worth-asking";
  return "long-shot";
}

/**
 * How much better the piece coming back has to be before "you moved up a tier"
 * is a true sentence rather than a rearrangement.
 *
 * Consolidating two players into one of equal value is not consolidating, it is
 * shuffling. Fifteen percent on the lead asset is the point at which the reader
 * is demonstrably holding a better player than either of the ones they sent.
 */
const TIER_JUMP = 1.15;

/** The shape of a candidate deal, as the goal tests need to read it. */
export type TradeShape = {
  incoming: number;
  outgoing: number;
  /** Value of the single best asset on each side. */
  incomingTop: number;
  outgoingTop: number;
};

/**
 * Does this deal do the thing the reader asked for?
 *
 * A goal is a constraint, not a hint. Somebody who picks "Obtain draft picks"
 * and is shown a deal with no picks in it has been ignored, however good the
 * deal is, and a weighting that merely prefers picks will hand them exactly that
 * the moment a big lineup upgrade turns up. So the goal filters first and the
 * weights only order what survives.
 *
 * What a goal constrains is the SHAPE, never the contents. "Obtain draft picks"
 * requires a pick to come back and says nothing about what may come with it, so
 * a first plus a starting receiver is squarely the thing being asked for.
 *
 * "Open to all trades" constrains nothing, which is what it says on the label.
 */
export function satisfiesGoal(
  goal: TradeGoal,
  mine: SideImpact,
  shape: TradeShape,
): boolean {
  switch (goal) {
    case "get-younger":
      return mine.ageDelta === null || mine.ageDelta < 0;
    case "add-picks":
      // At least one pick has to come back. Players alongside it are welcome,
      // which is why this reads the count rather than the composition: a first
      // and a starting receiver for one good player is squarely the deal a
      // reader asking for picks wants to be shown.
      return mine.pickCountDelta > 0;
    case "consolidate":
      // Several pieces out, fewer in, and the one coming back is genuinely
      // better than anything that left.
      return (
        shape.outgoing > shape.incoming &&
        shape.incomingTop >= shape.outgoingTop * TIER_JUMP
      );
    case "split-assets":
      // The mirror image: one good player out, several back, and what left was
      // the best asset in the deal. Without the second test this would accept
      // any two-for-one, including the ones where the reader is the one moving
      // up a tier, which is the opposite request.
      return (
        shape.incoming > shape.outgoing &&
        shape.outgoingTop >= shape.incomingTop * TIER_JUMP
      );
    default:
      return true;
  }
}

/**
 * How much a deal's score survives its acceptance band.
 *
 * The long-shot discount is severe on purpose. A long shot is a deal we have
 * already decided the other manager would refuse, so it has to be several times
 * better for the reader than a realistic one before it is worth their one slot
 * on screen. At 0.3 it was not: against real leagues a lopsided three-for-one
 * still led the ranking, because the reader's side of an unfair trade always
 * scores well. It surfaces now only once the sensible deals have been passed on,
 * which is where it belongs rather than gone entirely: sometimes the answer
 * genuinely is "you would have to overpay".
 */
const ACCEPTANCE_WEIGHT: Record<AcceptanceBand, number> = {
  likely: 1,
  "worth-asking": 0.75,
  // Raised from 0.12. The discount has to be heavy enough that a lopsided deal
  // never opens the ranking, and 0.12 was heavier than that: it pushed long
  // shots so far down that they effectively did not exist, and in a quiet league
  // the panel had nothing to show at all rather than showing the honest answer,
  // which is "you would have to overpay". A fifth is still a demotion of four
  // places or more against any realistic deal.
  "long-shot": 0.2,
};

/**
 * How much a term counts, before the reader's own footing is applied.
 *
 * One row per goal, replacing the switch that used to sit inside
 * scoreSuggestion. Same numbers, named rather than inlined, because the stance
 * multipliers below have to compose with them and two sets of magic constants
 * multiplied together in a switch statement is not something anybody can reason
 * about later.
 */
type ScoreWeights = {
  lineup: number;
  wins: number;
  value: number;
  youth: number;
  picks: number;
};

const GOAL_WEIGHTS: Record<TradeGoal, ScoreWeights> = {
  // Picks carry real weight here as well as youth: a rookie pick is the
  // youngest asset in the game and the reader asking for a younger roster wants
  // to be shown the ones that come with draft capital attached.
  "get-younger": { lineup: 0.3, wins: 0.3, value: 1, youth: 2, picks: 0.8 },
  "add-picks": { lineup: 0.2, wins: 0.2, value: 1.2, youth: 0, picks: 2.5 },
  // The shape is guaranteed by satisfiesGoal, so the ordering here is only
  // about which consolidation is the best one.
  consolidate: { lineup: 1.4, wins: 1.4, value: 1.2, youth: 0, picks: 0 },
  // Same two terms, because the question is the same one pointing the other
  // way: of the deals that split a good player up, which leaves the reader best
  // off. Youth counts a little, since upside is most of the reason to do this.
  "split-assets": { lineup: 1.4, wins: 1.4, value: 1.2, youth: 0.5, picks: 0 },
  balanced: { lineup: 1.3, wins: 1.3, value: 1, youth: 0.4, picks: 0.3 },
};

/**
 * How the reader's OWN footing rescales those weights.
 *
 * This is the half that was missing, and it is the difference between a trade
 * tool and advice. Every team in a league is handed the same ranking today: the
 * deal that adds the most trade value while nudging the lineup up. That is the
 * right answer for roughly a third of the league and the wrong one for the
 * rest. A team two games clear at the top does not want a 2028 first and a
 * 21-year-old; a team five games out does not want a 30-year-old back who wins
 * them a meaningless week 14.
 *
 * So the reader's Power Pulse standing (Contender / Bubble / Rebuilder, the
 * same call the rest of League Pulse renders, via lib/league-team-status.ts)
 * rescales what the score is measuring:
 *
 *   Contender. Wins are the point, so the schedule-aware wins term leads and
 *   the raw lineup term backs it up. Trade value is discounted rather than
 *   ignored: a contender still should not be talked into a bad deal, but a
 *   sideways deal that adds a starter is exactly what they are looking for.
 *   Youth and picks are close to worthless to them this season.
 *
 *   Rebuilder. The mirror image. Value, youth and draft capital lead; the
 *   lineup term is discounted rather than inverted, because points on Sunday
 *   are still points and a rebuild that also happens to score more is not
 *   worse. What it must not do is REWARD losing the lineup, which is why the
 *   multiplier is small and positive rather than negative.
 *
 *   Bubble, or a league Power Pulse has not scored. Everything at 1, which is
 *   exactly the behaviour that shipped before this existed. A team in the pack
 *   genuinely does want both, and a league with no Power Pulse row has told us
 *   nothing, so inventing a lean for it would be worse than staying neutral.
 *
 * Multipliers rather than a replacement set, so the goal the reader picked is
 * still the thing being ranked. Stance decides emphasis; the goal decides the
 * question, and satisfiesGoal decides membership.
 */
const STANCE_WEIGHTS: Record<TeamDirection, ScoreWeights> = {
  "win-now": { lineup: 1.2, wins: 2.2, value: 0.55, youth: 0.25, picks: 0.3 },
  balanced: { lineup: 1, wins: 1, value: 1, youth: 1, picks: 1 },
  rebuild: { lineup: 0.35, wins: 0.3, value: 1.6, youth: 1.5, picks: 1.6 },
};

/**
 * What one projected win is worth on the same scale as a point per week.
 *
 * A realistic full remaining slate converts at roughly a tenth of a win per
 * point per week (see lib/trade-finder/pulse.ts), so a deal worth two points a
 * week is worth about a fifth of a win. Scaling by ten puts that back on the
 * same footing as the raw lineup term, which is what makes the two comparable
 * in one sum without either running away with it.
 *
 * The two terms are NOT redundant even though one is derived from the other.
 * The lineup term says the roster got better. The wins term says how much that
 * is worth given how many games are left and how close they are, and it is the
 * only one of the two that can tell a week 3 upgrade from a week 16 one.
 */
const WINS_SCALE = 10;

/**
 * How good this deal is for the reader, weighted by their stated goal, scaled by
 * their team's own footing, and discounted by how unlikely it is to happen.
 *
 * The discount is what stops the ranking from opening on a fantasy. A deal worth
 * twice as much to the reader but rated a long shot lands below a modest one the
 * other manager would actually take, which is the correct order for a feature
 * whose output is meant to be sent rather than admired.
 *
 * Points per week, projected wins, and trade value are different units, so all
 * three are normalized before they meet: lineup gain against a full point a
 * week, wins against WINS_SCALE, value gain against the reader's own roster
 * total. None of them can run away with the score.
 */
export function scoreSuggestion(params: {
  mine: SideImpact;
  myProfile: TeamProfile;
  acceptance: AcceptanceBand;
  goal: TradeGoal;
}): number {
  const { mine, myProfile, goal } = params;
  const rosterValue = Math.max(myProfile.totalValue, 1);

  const lineupScore = (mine.lineupDelta ?? 0) / 1.0;
  // Zero rather than null-guarded away, and the distinction matters: a league
  // with no Power Pulse row contributes nothing to this term instead of being
  // scored against a made-up rate, which leaves the ranking exactly where it
  // was before any of this existed.
  const winsScore = (mine.winsDelta ?? 0) * WINS_SCALE;
  const valueScore = (mine.valueDelta / rosterValue) * 100;
  const youthScore = mine.ageDelta === null ? 0 : -mine.ageDelta * 2;
  const pickScore = mine.pickCountDelta * 0.6;

  const g = GOAL_WEIGHTS[goal] ?? GOAL_WEIGHTS.balanced;
  const stance = STANCE_WEIGHTS[myProfile.direction] ?? STANCE_WEIGHTS.balanced;

  const total =
    lineupScore * g.lineup * stance.lineup +
    winsScore * g.wins * stance.wins +
    valueScore * g.value * stance.value +
    youthScore * g.youth * stance.youth +
    pickScore * g.picks * stance.picks;

  return total * ACCEPTANCE_WEIGHT[params.acceptance];
}

export const SCORE_WEIGHTS = { GOAL_WEIGHTS, STANCE_WEIGHTS, WINS_SCALE };

export const RANK_THRESHOLDS = {
  EVEN_GAP,
  LOPSIDED_GAP,
  VISIBLE_LOSS_GAP,
  HURTS_LINEUP,
  SEVERE_LINEUP_LOSS,
  MEANINGFULLY_YOUNGER,
  TIER_JUMP,
};
