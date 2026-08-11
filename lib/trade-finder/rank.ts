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
import type { AcceptanceBand, FinderPlayer, SideImpact, TradeGoal } from "./types";

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

  return {
    valueDelta:
      incoming.reduce((s, a) => s + assetValue(a), 0) -
      outgoing.reduce((s, a) => s + assetValue(a), 0),
    lineupDelta:
      profile.startingTotal === null || afterTotal === null
        ? null
        : afterTotal - profile.startingTotal,
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
 * How good this deal is for the reader, weighted by their stated goal and
 * discounted by how unlikely it is to happen.
 *
 * The discount is what stops the ranking from opening on a fantasy. A deal worth
 * twice as much to the reader but rated a long shot lands below a modest one the
 * other manager would actually take, which is the correct order for a feature
 * whose output is meant to be sent rather than admired.
 *
 * Points per week and trade value are different units, so both are normalized
 * before they meet: lineup gain against a full point a week, value gain against
 * the reader's own roster total. Neither can run away with the score.
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
  const valueScore = (mine.valueDelta / rosterValue) * 100;
  const youthScore = mine.ageDelta === null ? 0 : -mine.ageDelta * 2;
  const pickScore = mine.pickCountDelta * 0.6;

  let total: number;
  switch (goal) {
    case "get-younger":
      // Picks carry real weight here as well as youth: a rookie pick is the
      // youngest asset in the game and the reader asking for a younger roster
      // wants to be shown the ones that come with draft capital attached.
      total = youthScore * 2 + valueScore * 1 + pickScore * 0.8 + lineupScore * 0.3;
      break;
    case "add-picks":
      total = pickScore * 2.5 + valueScore * 1.2 + lineupScore * 0.2;
      break;
    case "consolidate":
      // The shape is guaranteed by satisfiesGoal, so the ordering here is only
      // about which consolidation is the best one.
      total = lineupScore * 1.4 + valueScore * 1.2;
      break;
    case "split-assets":
      // Same two terms, because the question is the same one pointing the other
      // way: of the deals that split a good player up, which leaves the reader
      // best off. Youth counts a little, since upside is most of the reason to
      // do this at all.
      total = lineupScore * 1.4 + valueScore * 1.2 + youthScore * 0.5;
      break;
    default:
      total = lineupScore * 1.3 + valueScore * 1 + youthScore * 0.4 + pickScore * 0.3;
  }

  return total * ACCEPTANCE_WEIGHT[params.acceptance];
}

export const RANK_THRESHOLDS = {
  EVEN_GAP,
  LOPSIDED_GAP,
  VISIBLE_LOSS_GAP,
  HURTS_LINEUP,
  SEVERE_LINEUP_LOSS,
  MEANINGFULLY_YOUNGER,
  TIER_JUMP,
};
