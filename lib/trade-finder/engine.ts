/**
 * Trade Finder, end to end.
 *
 * Takes one league as plain data and returns the deals worth offering, best
 * first. The surface shows [0]; the rest exist so that "best" means something,
 * and so a pass has somewhere to go.
 *
 * The order of operations is the argument:
 *
 *   1. Read every team the same way. Direction, lineup, needs, surplus.
 *   2. For each counterparty, work out what they could part with and what the
 *      reader would want from it.
 *   3. Build offers that balance against each of those pieces.
 *   4. Go back for the reader's own assets nobody asked about, and build a deal
 *      around each of those instead.
 *   5. Measure what each offer does to BOTH teams.
 *   6. Rank on what it does for the reader, discounted by whether the other
 *      manager would take it, then order for variety.
 *
 * Step 5 is the one most trade tools skip, and it is why this one can say
 * something better than "these numbers are close". Step 6 is why the top
 * suggestion is usually modest: an offer that would be refused is worth less
 * than a smaller one that gets accepted.
 *
 * WHICH QUESTION IS BEING ASKED
 *   Every step above is run against ONE of two questions, and they routinely
 *   have different answers for the same league: does this deal win me games, or
 *   does it win me the trade? The reader picks in a dynasty league; a redraft
 *   league has only the first, because nothing carries past January.
 *
 *   Under the first question there is a HARD FLOOR rather than a weighting: a
 *   deal that costs points off the starting lineup is not built at all. Ranking
 *   those last was the previous behaviour and it was not enough, because the
 *   shortlist is walked with an arrow key, so a bad deal at position nine is
 *   still a deal put in front of somebody. See clearsContenderFloor in rank.ts,
 *   and the gate inside `build`, the closure in collect() that turns one
 *   candidate into a suggestion.
 *
 * VARIETY IS A FEATURE, NOT A FINISHING TOUCH
 *   Steps 3, 4 and 6 all exist because of the same production failure. Asked for
 *   twelve ideas, the engine returned twelve different players coming back for
 *   the same two or three going out, and in the worst real league three distinct
 *   payments across all twelve. A manager reading that has been handed one idea
 *   twelve times. The reader is here for somewhere to start, so a slightly worse
 *   deal they have not thought of beats a slightly better variant of the deal
 *   above it, and the ordering says so explicitly.
 *
 *   The same failure has a mirror image on the other side of the deal, and it
 *   survived the first fix: the reader kept being told to ACQUIRE the same
 *   player over and over. Every asset tally is now kept on both sides and fed
 *   back into the search while it runs, not merely consulted while reordering
 *   what it produced.
 *
 * ANSWERING BEATS ANSWERING PERFECTLY
 *   The bands that decide whether a package is fair are judgements, and a
 *   judgement that returns nothing is not a careful answer, it is a missing one.
 *   So the search runs on the WIDER bands and records, for each deal, whether it
 *   would also have cleared the strict ones. Strict-clearing deals sort ahead of
 *   the rest at every level: inside the package chooser, in the ranking, and in
 *   the variety walk. A reader with plenty of good options sees exactly what the
 *   strict search would have given them; a reader who would otherwise be told
 *   there is nothing gets the honest wider answer behind it.
 *
 *   This started life as two passes, strict then relaxed, on the theory that the
 *   second one only ran when the first had found almost nothing and was
 *   therefore cheap. Measurement said otherwise: the cost of a package is paid
 *   in the lineup fills of measureImpact, which happen BEFORE the bands can
 *   reject anything, so "found little" and "did little work" turned out to be
 *   unrelated. The most expensive search in the set was the one that triggered
 *   the retry, and running it twice cost 72% more for the same answer one pass
 *   produces.
 *
 * Cost is bounded at every level rather than by a timeout. A twelve-team league
 * evaluates eleven counterparties, at most ten acquirable pieces and six pairs
 * each, and at most three packages per piece, plus one anchored search per
 * uncovered asset, so the ceiling is a few hundred candidate deals and roughly
 * twice that many lineup fills. Widening the band changes which candidates are
 * scanned, which is arithmetic, not which are measured, which is the expense.
 *
 * Pure. No database, no React, no clock: two runs over the same league produce
 * the same suggestions in the same order, which is what makes a stored pass
 * still mean something on the next visit.
 */

import {
  buildTeamProfile,
  leagueStarterBaselines,
  type TeamProfile,
} from "./profile";
import {
  RELAXED_TOLERANCES,
  STRICT_TOLERANCES,
  acquirablePool,
  anchorCandidates,
  assetId,
  assetValue,
  balancePackages,
  givablePool,
  incomingCombos,
  type AssetRef,
  type QualityGate,
  type Tolerances,
} from "./packages";
import {
  DEFAULT_TRADE_QUALITY_CONFIG,
  type TradeQualityConfig,
} from "@/lib/trade-quality";
import {
  acceptanceOf,
  clearsContenderFloor,
  measureImpact,
  qualityRatioOf,
  satisfiesGoal,
  scoreSuggestion,
  valueGapOf,
} from "./rank";
import {
  buildCaveats,
  buildHeadline,
  buildPitch,
  buildRationale,
  buildTendencyReasons,
  buildWhyThem,
  buildWhyYou,
} from "./explain";
import {
  appetiteScore,
  avoidsPicks,
  bandAdjustment,
  resolveTendencyThresholds,
  sliceFor,
} from "./tendency";
import { suggestionKey } from "./fingerprint";
import {
  readTradePosition,
  resolveStrategy,
  TRADE_POSITIONS,
  TRADE_POSITION_PHRASE,
} from "./types";
import type {
  SuggestionAsset,
  TradeFinderInput,
  TradeFinderNotice,
  TradeFinderResult,
  TradeGoal,
  TradePosition,
  TradeStrategy,
  TradeSuggestion,
} from "./types";
// Type-only, same rule tendency.ts and types.ts hold: nothing runtime from
// lib/manager-pulse may reach the finder engine.
import type { ManagerTendency } from "@/lib/manager-pulse/types";

/** How many ranked suggestions a single run keeps. */
const MAX_RESULTS = 40;

/**
 * How many of the reader's own assets get a deal built around them when the
 * browse loop never mentioned them, and how many ideas each one gets.
 *
 * Two per asset rather than one because a single offer for a player reads as
 * the price, and a manager wants to know whether anyone else is in the market.
 */
const COVERAGE_ANCHORS = 14;
const COVERAGE_PER_ANCHOR = 2;

/**
 * How many ideas a NAMED player gets, when the reader has asked about one.
 *
 * Two is right when fourteen assets are each getting a turn and the panel has to
 * cover a roster. It is wrong when the reader has asked one question about one
 * player: they want the market, not a sample of it, and every idea here is a
 * distinct offer from a distinct manager rather than a variant.
 */
const NAMED_ANCHOR_TAKE = 12;

/**
 * How far down the roster the consolidation pairing reaches.
 *
 * Eight assets is twenty-eight pairs, of which the fourteen most valuable are
 * kept. Past that the pairs are two bench players adding up to a third bench
 * player, which is not moving up a tier and is not what anyone means by
 * consolidating.
 */
const CONSOLIDATE_PAIR_DEPTH = 8;

/** A need this size is worth naming in the explanation. Points per week. */
const NAMEABLE_NEED = 0.5;

/**
 * How much Manager Pulse tendency data favors this suggestion for the
 * counterparty receiving it, used ONLY as a final sort tiebreaker among
 * candidates the value and lineup math already rate as equal.
 *
 * Deliberately never folded into scoreSuggestion (lib/trade-finder/rank.ts).
 * That function's weights are each grounded against real production leagues,
 * with the reasoning written beside the number; appetiteScore has no such
 * grounding; it is a plausibility read on one manager's history, not a
 * measurement. Ordering equally-good candidates by it is a reasonable use of
 * that evidence; letting it outweigh, or even nudge, a value or wins term
 * that WAS measured against real trades would not be. Absent tendency data
 * this is 0 for every suggestion and changes nothing.
 */
function counterpartyAppetite(
  s: TradeSuggestion,
  tendencies: Map<number, ManagerTendency> | undefined,
  isDynasty: boolean,
): number {
  const slice = sliceFor(tendencies?.get(s.counterparty.rosterId), isDynasty);
  if (!slice) return 0;
  let total = 0;
  // Read against what THEY would receive: our outgoing side is their incoming
  // one.
  for (const asset of s.outgoing) {
    if (asset.kind !== "player") continue;
    total += appetiteScore(slice, readTradePosition(asset.position), asset.playerId);
  }
  return total;
}

/** Ids in the order given, with repeats dropped. */
function unique(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Does this side carry every player the reader pinned to it? */
function containsAll(assets: AssetRef[], playerIds: readonly string[]): boolean {
  if (playerIds.length === 0) return true;
  const present = new Set(assets.map(assetId));
  return playerIds.every((id) => present.has(id));
}

function toSuggestionAsset(asset: AssetRef): SuggestionAsset {
  if (asset.kind === "pick") {
    return {
      kind: "pick",
      key: asset.pick.key,
      label: asset.pick.label,
      season: asset.pick.season,
      round: asset.pick.round,
      value: asset.pick.value,
    };
  }
  const p = asset.player;
  return {
    kind: "player",
    playerId: p.playerId,
    sleeperId: p.sleeperId,
    name: p.name,
    position: p.position,
    team: p.team,
    value: p.value,
    age: p.age,
    projPoints: p.projPoints,
  };
}

/**
 * The position this deal actually fixes, when there is one.
 *
 * Chosen by the reader's measured need rather than by which incoming player is
 * most expensive, because the point of naming it is to explain WHY the lineup
 * moved. A trade that adds a fourth good receiver to a team already three deep
 * names no position, which is correct: nothing was fixed.
 */
function positionHelped(
  incoming: AssetRef[],
  mine: TeamProfile,
): { position: string; need: number } | null {
  let best: string | null = null;
  let bestNeed = NAMEABLE_NEED;
  for (const asset of incoming) {
    if (asset.kind !== "player") continue;
    const need = mine.positionNeed[asset.player.position] ?? 0;
    if (need > bestNeed) {
      bestNeed = need;
      best = asset.player.position;
    }
  }
  return best ? { position: best, need: bestNeed } : null;
}

/** The single most valuable asset in a set. */
function topValue(assets: AssetRef[]): number {
  let max = 0;
  for (const a of assets) max = Math.max(max, assetValue(a));
  return max;
}

/** A shape constraint the package search can apply while it builds. */
type ShapeConstraint = {
  accept?: (assets: AssetRef[]) => boolean;
  maxAssets?: number;
};

/** No constraint at all. What a named player gets, whatever the goal says. */
const NO_SHAPE: ShapeConstraint = {};

/** Does any player in this set play one of the named positions? */
function hasPosition(assets: AssetRef[], positions: ReadonlySet<string>): boolean {
  return assets.some((a) => a.kind === "player" && positions.has(a.player.position));
}

/**
 * The goal's shape constraint, with a position ask folded into it.
 *
 * Composed rather than replacing, because the two say different things and both
 * are true: "at least two pieces leave" and "one of them is a running back" is a
 * coherent request, and dropping either half answers a question nobody asked.
 *
 * The test is "at least one", never "only". A reader asking for a receiver has
 * not said the pick coming back alongside him is unwelcome, and refusing to name
 * that deal would hide the best version of the thing they asked for. Same
 * reasoning as the goals, which have always meant a shape rather than a filter.
 */
function withPositions(
  base: ShapeConstraint,
  positions: ReadonlySet<string>,
): ShapeConstraint {
  if (positions.size === 0) return base;
  const accept = base.accept;
  return {
    ...base,
    accept: (assets) =>
      hasPosition(assets, positions) && (!accept || accept(assets)),
  };
}

/**
 * How many assets the OUTGOING side needs, for goals that describe its shape.
 *
 * Expressed as a search constraint rather than a filter applied afterwards. The
 * package search prefers the smallest package that balances, so leaving this to
 * a downstream test meant every package it offered was a single asset and every
 * one of them was then rejected for being the wrong shape.
 */
function outgoingShapeFor(goal: TradeGoal): ShapeConstraint {
  if (goal === "consolidate") {
    return { accept: (assets) => assets.length >= 2, maxAssets: 3 };
  }
  if (goal === "split-assets") {
    // One piece leaves and several come back. More than one on the way out is a
    // different trade, and the goal test would refuse it anyway.
    return { maxAssets: 1 };
  }
  return {};
}

/** What the INCOMING side has to look like, when the goal says so. */
function incomingShapeFor(goal: TradeGoal): ShapeConstraint {
  if (goal === "add-picks") {
    // A pick has to be in it. Players alongside are welcome and common, which
    // is why this asks for at least one rather than for picks only.
    return { accept: (assets) => assets.some((a) => a.kind === "pick") };
  }
  if (goal === "split-assets") {
    return { accept: (assets) => assets.length >= 2 };
  }
  if (goal === "get-younger") {
    // Singles pass freely. A PAIR has to actually be about youth, or it is just
    // two players bundled, which the singles already describe one at a time.
    // Without this the goal was the only one paying for the pair scan and
    // getting nothing back for it: measured at 1.5x the engine time of every
    // other goal, for candidates the ranking then sorted to the bottom anyway.
    return {
      accept: (assets) =>
        assets.length < 2 ||
        assets.some(
          (a) =>
            a.kind === "pick" || (a.player.age !== null && a.player.age <= YOUNG_AGE),
        ),
    };
  }
  return {};
}

/** At or under this, a player counts as young for the get-younger shape test. */
const YOUNG_AGE = 25;

/** What one run of the whole search produced. */
type PassResult = {
  suggestions: TradeSuggestion[];
  considered: Set<number>;
  passedTargets: Set<string>;
  /**
   * Fingerprints of deals that only cleared the WIDER band.
   *
   * Not a rejection. These sort behind everything that cleared the strict band,
   * at both the ranking and the variety walk, so widening the search adds ideas
   * underneath the good ones instead of mixing them in.
   */
  loose: Set<string>;
  /**
   * Why the search could not run AS ASKED, when that is the reason for an
   * empty answer.
   *
   * Deliberately narrow. An ordinary empty result leaves this null and the
   * surface uses its own words; this is only for the cases where the question
   * itself describes a trade that cannot exist, which a reader has no way to
   * work out from "no trade to suggest".
   */
  notice: TradeFinderNotice | null;
};

/**
 * Would this deal have cleared the strict quality band?
 *
 * Read off the suggestion's own quality ratio, which is the same number the
 * search gate computed: qualityBalance reports the second side over the first,
 * and both the ordinary gate and the reversed one end up comparing outgoing
 * against incoming, exactly as qualityRatioOf does.
 *
 * The raw value gap is checked symmetrically rather than in the direction the
 * search happened to assemble, which makes this slightly conservative: a deal
 * whose assembled side overshoots can be filed as loose when the strict search
 * would have taken it. That costs nothing, because this only ever decides
 * ordering. Nothing is dropped on the strength of it.
 */
function clearsStrictBands(qualityRatio: number, valueGap: number): boolean {
  if (!Number.isFinite(qualityRatio)) return false;
  if (valueGap > STRICT_TOLERANCES.over) return false;
  return (
    qualityRatio >= 1 - STRICT_TOLERANCES.qualityUnder &&
    qualityRatio <= 1 + STRICT_TOLERANCES.qualityOver
  );
}

export function findTrades(input: TradeFinderInput): TradeFinderResult {
  const empty: TradeFinderResult = {
    suggestions: [],
    consideredTeams: 0,
    lineupUnavailable: false,
    notice: null,
  };

  const myTeam = input.teams.find((t) => t.rosterId === input.myRosterId);
  if (!myTeam) return empty;

  const slots = input.startingSlots;
  const baselines = leagueStarterBaselines(input.teams, slots);
  // isDynasty is what decides whether the Contender / Rebuilder call means
  // anything. In a one-year league every team is win-now, because there is no
  // future to hold an asset for. See the header of profile.ts.
  const profiles = input.teams.map((team) =>
    buildTeamProfile(team, slots, baselines, { isDynasty: input.isDynasty }),
  );
  const mine = profiles.find((p) => p.team.rosterId === input.myRosterId);
  if (!mine) return empty;

  const lineupUnavailable = profiles.every((p) => p.startingTotal === null);

  // The consolidation model, on admin settings when the caller loaded them and
  // on the published defaults when it did not. Either way the finder and Signal
  // Check are reading from the same curve, which is what stops the suggestion
  // and the grade printed beneath it from arguing.
  const quality = {
    config: input.quality?.config ?? DEFAULT_TRADE_QUALITY_CONFIG,
    poolMax: input.quality?.poolMax ?? null,
  };

  const { suggestions, considered, passedTargets, loose, notice } = collect(
    input,
    profiles,
    mine,
    slots,
    quality,
  );

  // A target the reader has already refused sinks below everything they have
  // not seen, and a deal that only cleared the wider band sinks below every deal
  // that cleared the strict one. Score decides inside each band, then the
  // fingerprint. The tiebreak is not cosmetic: two deals that score identically
  // must come back in the same order on every run, or a pass would move the
  // goalposts instead of advancing the queue.
  const ranked = [...suggestions].sort((a, b) => {
    const aPassed = passedTargets.has(targetKeyOf(a)) ? 1 : 0;
    const bPassed = passedTargets.has(targetKeyOf(b)) ? 1 : 0;
    if (aPassed !== bPassed) return aPassed - bPassed;
    const aLoose = loose.has(a.key) ? 1 : 0;
    const bLoose = loose.has(b.key) ? 1 : 0;
    if (aLoose !== bLoose) return aLoose - bLoose;
    if (a.score !== b.score) return b.score - a.score;
    // MANAGER PULSE'S PACKAGE-ORDERING EFFECT: reached only when the value
    // and lineup math already call two candidates equal. Absent tendency
    // data (the ordinary case today) both sides read 0 and this changes
    // nothing, so the sort falls straight through to the fingerprint exactly
    // as it did before this existed.
    const appetiteDelta =
      counterpartyAppetite(b, input.managerTendencies, input.isDynasty) -
      counterpartyAppetite(a, input.managerTendencies, input.isDynasty);
    if (appetiteDelta !== 0) return appetiteDelta;
    return a.key.localeCompare(b.key);
  });

  return {
    suggestions: selectVaried(
      ranked,
      (s) => passedTargets.has(targetKeyOf(s)),
      (s) => loose.has(s.key),
    ).slice(0, MAX_RESULTS),
    consideredTeams: considered.size,
    lineupUnavailable,
    // Only ever surfaced when there is nothing to show. A search that found
    // deals has already answered the reader, and telling them at the same time
    // that part of their question was impossible would be noise on a card they
    // are reading for something else.
    notice: suggestions.length === 0 ? notice : null,
  };
}

/**
 * The search itself.
 *
 * Split out of findTrades so the ranking and the variety walk read as one
 * paragraph rather than being buried under six hundred lines of loop.
 */
function collect(
  input: TradeFinderInput,
  profiles: TeamProfile[],
  mine: TeamProfile,
  slots: string[],
  quality: { config: TradeQualityConfig; poolMax: number | null },
): PassResult {
  // Every package is searched on the wider band and filed by whether it also
  // cleared the strict one. See the header: the strict band decides ORDER here,
  // not membership.
  const tolerances: Tolerances = RELAXED_TOLERANCES;

  const emptyPass = (notice: TradeFinderNotice | null = null): PassResult => ({
    suggestions: [],
    considered: new Set<number>(),
    passedTargets: new Set<string>(),
    loose: new Set<string>(),
    notice,
  });

  const excluded = new Set(input.excludeKeys);

  /**
   * The shape constraint, defaulting to "any".
   *
   * Trade Ideas no longer asks for one: the reader picks a strategy instead. The
   * constraint stays supported for callers that do want a shape, and normalizing
   * it once here is what lets everything downstream keep taking a plain
   * TradeGoal instead of an optional one.
   */
  const goal: TradeGoal = input.goal ?? "balanced";
  /**
   * What the ranking is measuring, resolved once.
   *
   * A redraft league lands on "contender" whatever arrived on the wire, because
   * a one-year league has no other honest answer. Resolved HERE rather than at
   * each use so the gate below, the score, and the sentence on the card can
   * never disagree about which question was asked.
   */
  const strategy: TradeStrategy | null = resolveStrategy(
    input.isDynasty,
    input.strategy,
  );
  /**
   * Deals the contender floor turned away.
   *
   * Counted rather than merely dropped, so an empty answer can say which of the
   * two empties it is. "Your league holds no deal for you" and "every deal on
   * the board would cost you points" are different facts and a reader acts on
   * them differently.
   */
  let rejectedForLineup = 0;

  // Deduplicated and order-preserving. Two chips for the same player is a
  // slip rather than a request for him twice, and a duplicate in the pinned
  // package would ask the search to send one player two times.
  const targetPlayerIds = unique(input.targetPlayerIds ?? []);
  const offerPlayerIds = unique(input.offerPlayerIds ?? []);
  const specificAsk = targetPlayerIds.length > 0 || offerPlayerIds.length > 0;

  // A named player settles the side he is on. Asking for a running back back AND
  // naming the quarterback you want is a contradiction, and the name is the more
  // specific request, so the ask on that side stands down. The OTHER side's ask
  // survives, which is the combination a reader actually types: "get me this
  // player, and take a running back off my hands".
  const wantPositions: ReadonlySet<string> = new Set(
    targetPlayerIds.length > 0 ? [] : (input.wantPositions ?? []),
  );
  const givePositions: ReadonlySet<string> = new Set(
    offerPlayerIds.length > 0 ? [] : (input.givePositions ?? []),
  );

  // The reader's own currency is the same whoever they are talking to, so it is
  // assembled once rather than per counterparty. A named player widens it: see
  // givablePool for why answering "what would it take" out of bench pieces is
  // not answering it.
  //
  // Naming a position to send widens it for the same reason. "Trade me a running
  // back" is a reader volunteering one, and a pool restricted to pieces the
  // roster can afford to lose holds their fourth back and not the one they meant.
  // Read back in the order the filter draws its chips, so two readers who picked
  // the same two groups get the same sentence whichever they pressed first.
  const askedPhrases = {
    want: TRADE_POSITIONS.filter((p) => wantPositions.has(p)).map(
      (p) => TRADE_POSITION_PHRASE[p],
    ),
    give: TRADE_POSITIONS.filter((p) => givePositions.has(p)).map(
      (p) => TRADE_POSITION_PHRASE[p],
    ),
  };

  const givable = givablePool(mine, {
    goal,
    strategy,
    offerPlayerIds,
    allowPicks: input.allowPicks,
    widen: specificAsk || givePositions.size > 0,
  });
  // The pinned outgoing package, in the order the reader named it. Read back
  // out of the pool rather than rebuilt, so a player the pool refused (no
  // value row) is missing here too and the search stands down instead of
  // pricing him at zero.
  const required: AssetRef[] = [];
  for (const playerId of offerPlayerIds) {
    const hit = givable.find((a) => assetId(a) === playerId);
    if (hit) required.push(hit);
  }

  // A player the reader wants to move but that we cannot find, or cannot
  // value, leaves nothing honest to build from. Reported rather than returned
  // as a bare empty: "we have no price for one of the players you named" is a
  // different answer from "your league has no deal for you".
  if (offerPlayerIds.length > 0 && required.length !== offerPlayerIds.length) {
    return emptyPass("offers-missing");
  }
  if (givable.length === 0) return emptyPass();

  const suggestions: TradeSuggestion[] = [];
  const seenKeys = new Set<string>();
  /**
   * Targets the reader has already passed on, by (counterparty, incoming).
   *
   * A pass removes one exact deal, which is the contract. But the engine can
   * build three ways to pay for the same player, so removing one and re-ranking
   * hands back a near-copy of what was just refused, and the button reads as
   * broken. Recording the target means every sibling package sinks below the
   * deals the reader has not seen, without any of them being lost: pass through
   * the distinct players and the alternative prices are still there behind them.
   */
  const passedTargets = new Set<string>();
  /** Deals that only cleared the wider band. Ordering, never exclusion. */
  const loose = new Set<string>();
  /**
   * How many offers each asset has already appeared in, on each side.
   *
   * Fed back into the balancing search as it works, so the second half of the
   * league is priced with the pieces the first half did not use. This is where
   * variety actually comes from: reordering a finished list cannot introduce an
   * offer the search never built, and against real leagues the search was
   * building the same two or three payments for every target in the league.
   */
  const outgoingUsage = new Map<string, number>();
  const incomingUsage = new Map<string, number>();
  /** Counterparties with something on the table, in either pass. */
  const considered = new Set<number>();

  const note = (tally: Map<string, number>, assets: AssetRef[]) => {
    for (const a of assets) {
      const id = assetId(a);
      tally.set(id, (tally.get(id) ?? 0) + 1);
    }
  };
  /** The same tally, fed from a finished suggestion rather than from refs. */
  const noteAssets = (tally: Map<string, number>, assets: SuggestionAsset[]) => {
    for (const a of assets) {
      const id = a.kind === "player" ? a.playerId : a.key;
      tally.set(id, (tally.get(id) ?? 0) + 1);
    }
  };

  /**
   * Turn one (counterparty, incoming, outgoing) into a ranked suggestion, or
   * null when it fails a gate.
   *
   * `allowNeutral` keeps a deal the arithmetic rates as doing nothing for the
   * reader. The browse loop rejects those; the coverage pass below keeps them,
   * on the same reasoning that already applies to a named target. "Here is what
   * this player brings back" is worth an answer even when the answer is a
   * sideways move, because the reader is looking for somewhere to start.
   */
  const build = (
    theirs: TeamProfile,
    incoming: AssetRef[],
    outgoing: AssetRef[],
    opts: { allowNeutral: boolean },
  ): TradeSuggestion | null => {
    const key = suggestionKey({
      counterpartyRosterId: theirs.team.rosterId,
      incoming: incoming.map(toSuggestionAsset),
      outgoing: outgoing.map(toSuggestionAsset),
    });
    if (seenKeys.has(key)) return null;
    if (excluded.has(key)) {
      passedTargets.add(targetKey(theirs.team.rosterId, incoming));
      // A passed deal still counts against the tallies. The reader HAS seen
      // these players offered, which is why they passed, and counting them
      // keeps the search on the same path it took before the pass: the packages
      // built for later targets do not shift under the reader just because they
      // said no to an earlier one.
      note(outgoingUsage, outgoing);
      note(incomingUsage, incoming);
      return null;
    }

    // THE POSITION ASK IS A HARD GATE, not a preference.
    //
    // The pools and the shape tests above already steer the search, and this
    // catches the paths they cannot reach: a combination assembled by
    // incomingCombos, and the coverage pass, which fixes one side outright
    // rather than building it. A reader who asked for a receiver and was shown a
    // tight end would read the whole control as decoration.
    if (wantPositions.size > 0 && !hasPosition(incoming, wantPositions)) return null;
    if (givePositions.size > 0 && !hasPosition(outgoing, givePositions)) return null;

    // THE NAMED PACKAGE IS A HARD GATE TOO, and for a stronger reason than the
    // position ask: a reader who typed three names and is shown a deal for two
    // of them has been handed a trade they did not ask about, in a card that
    // looks exactly like the one they did. The pools already pin both sides,
    // and this catches the paths that assemble a side rather than fixing it.
    if (!containsAll(incoming, targetPlayerIds)) return null;
    if (!containsAll(outgoing, offerPlayerIds)) return null;

    // MANAGER PULSE: what this counterparty's own Sleeper history says about
    // them, read once per candidate. Absent tendency data (no cached row, or
    // the manager reads null for this league's game type) makes every one of
    // these a no-op, so a league nobody has looked up behaves exactly as
    // Trade Ideas does today. See lib/trade-finder/tendency.ts for what each
    // of these is and is not allowed to do: never the value or wins math,
    // only the acceptance band by at most one step, package ordering, and
    // reason sentences (docs/manager-pulse/manager-pulse-plan.md section 8.3).
    const theirTendencySlice = sliceFor(
      input.managerTendencies?.get(theirs.team.rosterId),
      input.isDynasty,
    );
    // Resolved from the caller's settings, falling back to the published
    // defaults. Never a constant read out of this file: see the header of
    // lib/trade-finder/tendency.ts for why a copy of an admin number is a
    // number that eventually disagrees with its original.
    const tendencyThresholds = resolveTendencyThresholds(input.tendencyThresholds);

    // PACKAGE ORDERING, THE SKIP HALF: a manager who has never moved a pick
    // across enough trades to call it a pattern is not going to be won over
    // by one now, so a pick-based shape is dropped for them entirely rather
    // than ranked low. A NAMED ask is exempt, same reasoning as every other
    // shape gate above: a reader who typed a pick into the search is asking
    // about that pick, not asking to be steered away from it.
    if (
      !specificAsk &&
      avoidsPicks(theirTendencySlice, tendencyThresholds.minSample) &&
      [...incoming, ...outgoing].some((a) => a.kind === "pick")
    ) {
      return null;
    }

    const myImpact = measureImpact(mine, slots, incoming, outgoing);

    // BOTH GATES THAT READ ONLY THE READER'S SIDE RUN HERE, before the other
    // team's ledger is measured. That ordering buys most of the cost of a
    // redraft search. measureImpact is an optimal-lineup refill, the most
    // expensive thing in this function, and it is called twice; the floor below
    // turns away the large majority of everything a one-year league builds, so
    // measuring the counterparty first meant paying a second fill for each of
    // those and never reading it. Measured on a 12-team, 22-player league:
    // 1734 fills before, 1058 after, the same 15 suggestions out of both.

    // THE CONTENDER FLOOR. A hard gate, and the reason this file gained a
    // strategy at all.
    //
    // In a redraft league, and in a dynasty league where the reader has pressed
    // Contender, a deal that costs points off the starting lineup is not a
    // lower-ranked idea, it is the wrong answer. The score already leaned
    // against those deals and leaning was not enough: the shortlist is something
    // a reader walks through with an arrow key, and a coverage-pass deal that
    // gives up two points a week sat in the same card, in the same shape, as one
    // that gained them.
    //
    // A NAMED PACKAGE IS EXEMPT, on the same reasoning that already exempts it
    // from the shape test and from the score gate. "What does this player bring
    // back" is a question that deserves its answer even when the answer is a
    // step sideways; the card states the lineup change either way, so nothing is
    // hidden. What the reader must not get is an UNPROMPTED suggestion that
    // makes their team worse at football.
    if (strategy === "contender" && !specificAsk && !clearsContenderFloor(myImpact)) {
      rejectedForLineup += 1;
      return null;
    }

    // The goal is a constraint. A reader who asked for picks and is shown a
    // deal without one has been ignored, however good it is.
    //
    // Naming a player overrides it, from EITHER side, because naming a player is
    // the more specific request. This applied only to the player the reader
    // wanted, and the asymmetry had teeth: the anchored search always sends
    // exactly one asset, so "Consolidate" plus a named player to move could
    // never satisfy the shape test and returned nothing at all for every star on
    // the roster. A reader who has typed a name is asking about that player, not
    // about the shape they asked for a minute ago.
    if (
      !specificAsk &&
      !satisfiesGoal(goal, myImpact, {
        incoming: incoming.length,
        outgoing: outgoing.length,
        incomingTop: topValue(incoming),
        outgoingTop: topValue(outgoing),
      })
    ) {
      return null;
    }

    // The other team's ledger is this one reversed: what the reader sends is
    // what they receive. Nothing above reads it, which is why it waits until
    // here.
    const theirImpact = measureImpact(theirs, slots, outgoing, incoming);

    const gap = valueGapOf(incoming, outgoing);
    const qualityRatio = qualityRatioOf(incoming, outgoing, quality);
    // THE ACCEPTANCE BAND, THE ONE PLACE A TENDENCY MAY MOVE IT: at most one
    // step, computed and clamped in tendency.ts, never touching the value or
    // lineup arithmetic above this line.
    const tendencyAdjustment = bandAdjustment(theirTendencySlice, tendencyThresholds);
    const acceptance = acceptanceOf(
      theirImpact,
      theirs,
      gap,
      qualityRatio,
      tendencyAdjustment.steps,
    );
    const score = scoreSuggestion({
      mine: myImpact,
      myProfile: mine,
      acceptance,
      goal,
      strategy,
    });

    // A deal that does nothing for the reader is not a suggestion.
    if (score <= 0 && targetPlayerIds.length === 0 && !opts.allowNeutral) return null;

    seenKeys.add(key);
    if (!clearsStrictBands(qualityRatio, gap)) loose.add(key);

    const incomingAssets = incoming.map(toSuggestionAsset);
    const outgoingAssets = outgoing.map(toSuggestionAsset);
    const helped = positionHelped(incoming, mine);

    return {
      key,
      counterparty: {
        rosterId: theirs.team.rosterId,
        teamName: theirs.team.teamName,
        ownerHandle: theirs.team.ownerHandle,
        statusLabel: theirs.team.statusLabel,
        direction: theirs.direction,
      },
      incoming: incomingAssets,
      outgoing: outgoingAssets,
      mine: myImpact,
      theirs: theirImpact,
      valueGap: gap,
      qualityRatio,
      acceptance,
      score,
      headline: buildHeadline(incomingAssets, outgoingAssets, theirs.team.teamName),
      rationale: buildRationale({
        goal,
        direction: theirs.direction,
        teamName: theirs.team.teamName,
        positionHelped: helped?.position ?? null,
        needPoints: helped?.need ?? null,
        named:
          targetPlayerIds.length > 0
            ? "target"
            : offerPlayerIds.length > 0
              ? "offer"
              : null,
        namedCount:
          targetPlayerIds.length > 0 ? targetPlayerIds.length : offerPlayerIds.length,
        // The reader's own footing, which is what scoreSuggestion weighted this
        // deal by. Without it the card explains the counterparty's situation and
        // says nothing about why the ranking put THIS deal in front of THIS team.
        myDirection: mine.direction,
        isDynasty: input.isDynasty,
        strategy,
        asked: askedPhrases,
        mine: myImpact,
      }),
      whyYou: buildWhyYou(myImpact, goal, helped?.position ?? null),
      // whyThem is unchanged from before Manager Pulse existed: tendency
      // sentences no longer ride along inside it (docs/manager-pulse/manager-pulse-plan.md
      // section 8.4 wants them as their own quiet line on the card, not
      // folded into the counterparty paragraph).
      whyThem: buildWhyThem(
        theirImpact,
        theirs.direction,
        theirs.team.teamName,
        theirs.team.statusLabel,
      ),
      // Manager Pulse's own field. `bandAdjustment` is passed straight
      // through so the sentence explaining a band move and the computation
      // that actually moved it can never disagree (see explain.ts
      // buildTendencyReasons). Absent tendency data this is an empty array.
      tendencyNotes: buildTendencyReasons({
        slice: theirTendencySlice,
        bandAdjustment: tendencyAdjustment,
        positionsTheyReceive: outgoingAssets
          .map((a) => (a.kind === "player" ? readTradePosition(a.position) : null))
          .filter((p): p is TradePosition => p !== null),
        involvesPick: [...incoming, ...outgoing].some((a) => a.kind === "pick"),
        settings: tendencyThresholds,
      }),
      pitch: buildPitch({
        outgoing: outgoingAssets,
        incoming: incomingAssets,
        theirs: theirImpact,
        direction: theirs.direction,
        valueGap: gap,
      }),
      caveats: buildCaveats({
        // How much runway a lineup change still has. A gain of two points a
        // week with two games left is a different proposition from the same
        // gain in week 4, and the projected-wins figure alone does not say so.
        remainingGames:
          myImpact.winsDelta === null
            ? null
            : (mine.team.pulse?.remainingGames ?? null),
        rosterSpotDelta:
          outgoing.filter((a) => a.kind === "player").length -
          incoming.filter((a) => a.kind === "player").length,
        lineupAvailable: myImpact.lineupDelta !== null,
        assumedPickSlots: [...incoming, ...outgoing].some(
          (a) => a.kind === "pick" && a.pick.pickPosition === "unknown",
        ),
        missingProjection: incoming
          .filter((a) => a.kind === "player" && a.player.projPoints === null)
          .map((a) => (a.kind === "player" ? a.player.name : "")),
      }),
    };
  };

  // A named player is the more specific request and overrides the goal, exactly
  // as the goal test in build() does. Leaving the shape constraints on would
  // filter the named player out of his own search before the override ever got a
  // chance to run: ask for picks, then ask about a tight end, and the incoming
  // side would be required to contain a pick that the tight end is not.
  //
  // The POSITION ask is folded back in afterwards, because it is not the goal
  // and a named player on one side does not answer it on the other. "Get me this
  // quarterback, and take a running back" needs the outgoing ask to survive the
  // naming of the incoming player; the sets above have already stood down on
  // whichever side was named.
  const outgoingShape = withPositions(
    specificAsk ? NO_SHAPE : outgoingShapeFor(goal),
    givePositions,
  );
  const incomingShape = withPositions(
    specificAsk ? NO_SHAPE : incomingShapeFor(goal),
    wantPositions,
  );

  // Which rosters, if any, could supply the whole package the reader asked for.
  //
  // Three distinct failures hide behind one empty answer, and they need
  // different sentences: the players are on different rosters, nobody in the
  // league has them, or one roster has them all but we hold no value for one
  // of them. The last is the one worth separating out, because reporting it
  // as "different teams" states something about the league the reader can see
  // is false on the next tab.
  let anyTeamHoldsTargets = targetPlayerIds.length === 0;
  let anyTeamRostersTargets = false;
  let targetsFoundSomewhere = false;
  if (targetPlayerIds.length > 0) {
    const wanted = new Set(targetPlayerIds);
    for (const other of profiles) {
      if (other.team.rosterId === input.myRosterId) continue;
      let held = 0;
      for (const p of other.team.players) {
        if (wanted.has(p.playerId)) held += 1;
      }
      if (held > 0) targetsFoundSomewhere = true;
      // Membership only. Whether we can PRICE them is the acquirable pool's
      // question, and the gap between the two answers is the unpriced case.
      if (held === targetPlayerIds.length) {
        anyTeamRostersTargets = true;
        break;
      }
    }
  }

  for (const theirs of profiles) {
    if (theirs.team.rosterId === input.myRosterId) continue;

    const acquirable = acquirablePool(theirs, mine, {
      goal,
      strategy,
      targetPlayerIds,
      allowPicks: input.allowPicks,
      positions: wantPositions.size > 0 ? wantPositions : null,
    });
    if (acquirable.length === 0) continue;
    if (targetPlayerIds.length > 0) anyTeamHoldsTargets = true;
    considered.add(theirs.team.rosterId);

    // What the reader might receive. One piece at a time, plus genuine
    // combinations for the goals whose whole shape is "more than one thing
    // comes back".
    //
    // A NAMED PACKAGE skips the combination walk entirely. The reader has
    // already said what the incoming side is, and letting incomingCombos take
    // it apart would offer subsets of the package as if they were answers: ask
    // what two receivers cost together and be quoted a price for one of them.
    const incomingSets =
      targetPlayerIds.length > 0
        ? [acquirable]
        : incomingCombos(acquirable, goal).filter(
            (set) => !incomingShape.accept || incomingShape.accept(set),
          );

    for (const incoming of incomingSets) {
      const target = incoming.reduce((sum, a) => sum + assetValue(a), 0);
      if (target <= 0) continue;

      const gate: QualityGate = {
        config: quality.config,
        poolMax: quality.poolMax,
        incomingValues: incoming.map(assetValue),
      };
      const packages = balancePackages(target, givable, {
        required,
        maxAssets: outgoingShape.maxAssets,
        accept: outgoingShape.accept,
        quality: gate,
        usage: outgoingUsage,
        tolerances,
      });

      for (const outgoing of packages) {
        const suggestion = build(theirs, incoming, outgoing, { allowNeutral: false });
        if (!suggestion) continue;
        suggestions.push(suggestion);
        note(outgoingUsage, outgoing);
        note(incomingUsage, incoming);
      }
    }
  }

  /**
   * Coverage: every asset the reader owns gets somewhere to start.
   *
   * The loop above only ever offers a piece that happens to be the right price
   * for somebody else's spare parts, which on a real roster leaves most of the
   * team unmentioned: measured against production leagues, a reader holding
   * fourteen tradeable assets could be shown three of them, and their best
   * player was never one. That is not an answer, it is a blind spot, and the
   * question "what could I get for him" is the most natural one a manager asks.
   *
   * So each asset anchors its own search, with the deal built around it instead
   * of it being built around somebody else. The fairness bands are the same ones
   * every other suggestion passes, so an idea that cannot come back level is
   * still not shown. What changes is only which question gets asked.
   *
   * WHY THIS RUNS FOR A NAMED PLAYER TOO
   *   It used to be skipped entirely whenever the reader named somebody, and
   *   that is exactly backwards. This pass is the ONLY one that can build a
   *   multi-piece return around a single expensive player, because the browse
   *   loop fixes the incoming side and asks what pays for it, and nothing in a
   *   normal roster's spare parts costs as much as a quarterback anyone wants.
   *   So a reader who watched the engine suggest a deal for a star, then typed
   *   that star's name into "player you would move", was told no trade could be
   *   found, by the code that had just built one. Naming a player now anchors
   *   this pass on him instead of turning it off.
   *
   * WHY AN ANCHOR IS A SET RATHER THAN AN ASSET
   *   It used to send exactly one piece, and that made this pass structurally
   *   incapable of consolidating: "two or three out, one better one back" cannot
   *   be built from a fixed side of one. Consolidation was therefore left
   *   entirely to the browse loop, which fixes the INCOMING side from what the
   *   other team can spare, and what a team can spare is by definition not a
   *   tier above what the reader is sending. So the one goal whose whole purpose
   *   is moving up a tier could only be offered deals that did not. On a league
   *   with real tiers it returned nothing at all.
   *
   *   The fixed side is now a set. For most goals it holds one asset, exactly as
   *   before. For consolidation it holds a pair, and the search asks the question
   *   that goal is actually about: who has one player worth roughly what these
   *   two are worth together.
   */
  const anchorSets: AssetRef[][] = required.length > 0
    ? [required]
    : (() => {
        const mentioned = new Set<string>();
        for (const s of suggestions) {
          for (const a of s.outgoing) {
            mentioned.add(a.kind === "player" ? a.playerId : a.key);
          }
        }
        const candidates = anchorCandidates(mine, {
          goal,
          strategy,
          allowPicks: input.allowPicks,
          positions: givePositions.size > 0 ? givePositions : null,
        });

        if (goal === "consolidate") {
          // Pairs drawn from the top of the roster, because two pieces nobody
          // wants do not add up to one somebody does, and bounded so the pairing
          // stays a constant rather than a square.
          //
          // Walked diagonally rather than sorted by combined value. Sorting that
          // way puts every pair containing the single best asset at the front,
          // so the fourteen kept were fourteen ways to trade the same player and
          // the reader was handed one idea over and over. The diagonal takes
          // neighbours first, which spreads the lead asset across the roster.
          const head = candidates.slice(0, CONSOLIDATE_PAIR_DEPTH);
          const pairs: AssetRef[][] = [];
          for (let span = 1; span < head.length && pairs.length < COVERAGE_ANCHORS; span += 1) {
            for (let i = 0; i + span < head.length && pairs.length < COVERAGE_ANCHORS; i += 1) {
              pairs.push([head[i], head[i + span]]);
            }
          }
          return pairs;
        }

        return candidates
          .filter((a) => !mentioned.has(assetId(a)))
          .slice(0, COVERAGE_ANCHORS)
          .map((a) => [a]);
      })();

  // A named target is answered by the browse loop, which already fixes those
  // players on the incoming side; anchoring the reader's own assets as well
  // would build deals that do not contain the players they asked about.
  if (targetPlayerIds.length === 0) {
    for (const anchorSet of anchorSets) {
      const anchorValue = anchorSet.reduce((sum, a) => sum + assetValue(a), 0);
      if (anchorValue <= 0) continue;
      const found: TradeSuggestion[] = [];

      for (const theirs of profiles) {
        if (theirs.team.rosterId === input.myRosterId) continue;
        // Recomputed rather than reused: a comparable piece on their side is
        // only on the table because the reader is putting up an equal one, so
        // it depends on this anchor and cannot be cached across anchors.
        const pool = acquirablePool(theirs, mine, {
          goal,
          strategy,
          targetPlayerIds: [],
          allowPicks: input.allowPicks,
          comparableTo: anchorValue,
          positions: wantPositions.size > 0 ? wantPositions : null,
        }).filter((a) => !anchorSet.some((held) => assetId(held) === assetId(a)));
        if (pool.length === 0) continue;
        // A team with nothing spare can still have somebody the reader can
        // match, so this pass reaches counterparties the browse loop skipped.
        considered.add(theirs.team.rosterId);

        // Sides swapped: the fixed side is what the reader SENDS, and the
        // package being assembled is what comes back.
        const gate: QualityGate = {
          config: quality.config,
          poolMax: quality.poolMax,
          incomingValues: anchorSet.map(assetValue),
          reversed: true,
        };
        const returns = balancePackages(anchorValue, pool, {
          quality: gate,
          usage: incomingUsage,
          tolerances,
          // Consolidating means ONE piece comes back. Anything else would be
          // the shape the reader asked to move away from.
          maxAssets: goal === "consolidate" ? 1 : undefined,
          accept: incomingShape.accept,
        });

        for (const incoming of returns) {
          const suggestion = build(theirs, incoming, anchorSet, { allowNeutral: true });
          if (suggestion) found.push(suggestion);
        }
      }

      found.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

      // Keep the best few, but never two that bring back the same lead player.
      // Without this the two ideas offered for one anchor were routinely the
      // same acquisition at two prices, which is one idea printed twice.
      const take = required.length > 0 ? NAMED_ANCHOR_TAKE : COVERAGE_PER_ANCHOR;
      const kept: TradeSuggestion[] = [];
      const keptLeads = new Set<string>();
      for (const s of found) {
        if (kept.length >= take) break;
        const lead = incomingLeadKeyOf(s);
        if (keptLeads.has(lead)) continue;
        keptLeads.add(lead);
        kept.push(s);
      }

      for (const s of kept) {
        suggestions.push(s);
        note(outgoingUsage, anchorSet);
        // The missing half of the tally. Without this line the incoming counts
        // never grew during coverage, so every anchor's return search saw a
        // pool where nothing had been used yet and reached for the same
        // attractive players again. That is the "it keeps telling me to acquire
        // the same guy" report, and it survived the outgoing-side fix precisely
        // because only the outgoing side was being counted.
        noteAssets(incomingUsage, s.incoming);
      }
    }
  }

  return {
    suggestions,
    considered,
    passedTargets,
    loose,
    // A package the reader asked to receive that no single roster holds. The
    // search ran and found nothing because the question describes a trade with
    // three sides, and saying so is the only useful thing we can tell them.
    notice: noticeFor({
      named: targetPlayerIds.length,
      priced: anyTeamHoldsTargets,
      rostered: anyTeamRostersTargets,
      foundSomewhere: targetsFoundSomewhere,
      built: suggestions.length > 0,
      // Only meaningful once nothing survived. A shortlist that has deals in it
      // has already answered the reader, and the deals the floor turned away are
      // the ones they asked not to see.
      rejectedForLineup,
    }),
  };
}

/**
 * Why a named-target search came back empty, when the reason is the question.
 *
 * Four distinct failures, and a reader can act on each of them differently:
 * move a chip to another roster, pick somebody we actually have a price for,
 * or ask for fewer players. Collapsing them into one sentence sends a reader
 * to fix the wrong thing, and collapsing the unpriced case into "different
 * teams" states something about the league they can see is false on the next
 * tab.
 *
 * Returns null the moment the search produced anything at all. A suggestion
 * on screen has already answered the reader, and a note beside it explaining
 * why some other version of the question failed is noise.
 */
function noticeFor(state: {
  named: number;
  /** Some roster holds them all AND we can price every one of them. */
  priced: boolean;
  /** Some roster holds them all, whatever we know about their value. */
  rostered: boolean;
  /** At least one of them is on some other roster in this league. */
  foundSomewhere: boolean;
  built: boolean;
  /**
   * How many otherwise-valid deals the contender floor turned away.
   *
   * Read only when the shortlist is empty and no player was named, which is
   * exactly the case a redraft reader hits: the league is full of tradeable
   * players, the search ran, and every deal it built would have cost them points
   * on Sunday. Without this the surface says "no trade to suggest" and the
   * reader concludes the tool is broken.
   */
  rejectedForLineup?: number;
}): TradeFinderNotice | null {
  if (state.built) return null;
  if (state.named === 0) {
    return (state.rejectedForLineup ?? 0) > 0 ? "no-lineup-gain" : null;
  }
  if (state.priced) {
    // The pieces were all on the table and nothing on the reader's roster
    // adds up to them. Naming fewer is the move, and no other sentence here
    // would tell them that.
    return state.named > 1 ? "targets-unaffordable" : null;
  }
  if (state.rostered) return "targets-unpriced";
  return state.foundSomewhere ? "targets-split" : "targets-missing";
}

/** Identifies "this player, from this team", whatever the price. */
function targetKey(rosterId: number, incoming: AssetRef[]): string {
  const ids = incoming
    .map((a) => (a.kind === "player" ? a.player.playerId : a.pick.key))
    .sort();
  return `${rosterId}|${ids.join(",")}`;
}

function targetKeyOf(s: TradeSuggestion): string {
  const ids = s.incoming
    .map((a) => (a.kind === "player" ? a.playerId : a.key))
    .sort();
  return `${s.counterparty.rosterId}|${ids.join(",")}`;
}

/** The single most valuable thing the reader would be sending. */
function paymentKeyOf(s: TradeSuggestion): string {
  let best: SuggestionAsset | null = null;
  for (const asset of s.outgoing) {
    if (!best || asset.value > best.value) best = asset;
  }
  if (!best) return "";
  return best.kind === "player" ? best.playerId : best.key;
}

/**
 * The headline asset coming back.
 *
 * The whole incoming set used to be the variety key, and that quietly let the
 * same acquisition through repeatedly: "Olave", "Olave and a 2027 3rd", and
 * "Olave and a bench back" are three different sets and one idea. What a reader
 * notices is the name at the front of the card, so that is what is counted.
 */
function incomingLeadKeyOf(s: TradeSuggestion): string {
  let best: SuggestionAsset | null = null;
  for (const asset of s.incoming) {
    if (!best || asset.value > best.value) best = asset;
  }
  if (!best) return "";
  return best.kind === "player" ? best.playerId : best.key;
}

/**
 * Candidates the variety walk considers. Everything past it is already far
 * enough down the ranking that no surface will reach it, and scanning the whole
 * field would cost more than the ordering is worth.
 */
const DIVERSITY_POOL = 200;

function bump(tally: Map<string, number>, key: string): void {
  tally.set(key, (tally.get(key) ?? 0) + 1);
}

/**
 * Emit the ranked deals in an order a person can browse.
 *
 * This replaced three separate reordering passes (one for the incoming player,
 * one for the outgoing player, one for the team) that ran in sequence, and the
 * reason it had to is that each one reshuffled the last one's work: the team
 * pass would pull back a deal paying with the asset the player pass had just
 * moved away. Against production leagues the result was three consecutive
 * offers led by the same player, in a pipeline containing code whose entire job
 * was preventing exactly that.
 *
 * One walk, one set of rules. The next deal shown is never a repeat of the one
 * directly before it, on the asset going out, the asset coming back, or the
 * partner, while an alternative exists. Among the rest it is whichever repeats
 * least of everything shown so far, and only then the better score. Freshness
 * beats a better deal on purpose. The reader is being handed ideas to build on,
 * and the eighth variant of one idea is worth less to them than the first
 * version of a new one.
 *
 * The incoming guard is measured on the LEAD asset rather than the whole set,
 * because a reader looking at two cards that both open with the same player has
 * been shown that player twice whatever else was bundled with him.
 *
 * The opener is exempt: it is the best deal in the league, full stop. Variety
 * decides everything after it.
 *
 * Nothing is dropped or filtered. Deals on a target the reader already passed
 * on stay behind every deal they have not seen, which is the pass contract.
 * Deterministic throughout, so a pass advances the queue rather than reshuffling
 * it.
 */
function selectVaried(
  sorted: TradeSuggestion[],
  isPassed: (s: TradeSuggestion) => boolean,
  isLoose: (s: TradeSuggestion) => boolean,
): TradeSuggestion[] {
  if (sorted.length <= 2) return sorted;

  // Precomputed once per suggestion rather than recomputed for every candidate
  // on every round of the walk below, which is quadratic and was re-deriving
  // keys that cannot change.
  const rows = sorted.slice(0, DIVERSITY_POOL).map((s) => ({
    s,
    outKey: paymentKeyOf(s),
    inKey: incomingLeadKeyOf(s),
    partner: s.counterparty.rosterId,
    passed: isPassed(s) ? 1 : 0,
    loose: isLoose(s) ? 1 : 0,
  }));
  const remaining = rows;
  const tail = sorted.slice(DIVERSITY_POOL);
  const out: TradeSuggestion[] = [];

  const outgoingUses = new Map<string, number>();
  const incomingUses = new Map<string, number>();
  const partnerUses = new Map<string, number>();

  let lastOutgoing: string | null = null;
  let lastIncoming: string | null = null;
  let lastPartner: number | null = null;

  const take = (index: number) => {
    const [next] = remaining.splice(index, 1);
    out.push(next.s);
    bump(outgoingUses, next.outKey);
    bump(incomingUses, next.inKey);
    bump(partnerUses, String(next.partner));
    lastOutgoing = next.outKey;
    lastIncoming = next.inKey;
    lastPartner = next.partner;
  };

  take(0);

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestKey: number[] | null = null;
    let bestTiebreak = "";

    for (let i = 0; i < remaining.length; i += 1) {
      const row = remaining[i];
      const s = row.s;
      const { outKey, inKey } = row;
      const outUses = outgoingUses.get(outKey) ?? 0;
      const inUses = incomingUses.get(inKey) ?? 0;
      const repeatOut = outKey === lastOutgoing ? 1 : 0;
      const repeatIn = inKey === lastIncoming ? 1 : 0;
      const key = [
        row.passed,
        // Never twice in a row, on either asset, while an alternative exists.
        // These outrank the tallies below because two similar cards back to back
        // is the failure a reader notices first, and keeping every guard inside
        // ONE key is what stops them undoing each other the way the separate
        // reordering passes did.
        //
        // The SUM comes first so the two guards cannot be played off against
        // each other. Ranked one above the other, a deal that kept the payment
        // fresh outranked one that kept the acquisition fresh, and once the only
        // remaining fresh payments all led with the same incoming player the
        // reader was handed that player two and three cards running: the exact
        // repetition this pair of guards exists to prevent, produced by the
        // guards themselves.
        repeatOut + repeatIn,
        // When something has to repeat, repeat the payment rather than the
        // acquisition. Two ways to pay for one player is a price and an
        // alternative; two players you could get for one asset is two ideas.
        // The second is worth more to a reader looking for somewhere to start.
        repeatIn,
        repeatOut,
        row.partner === lastPartner ? 1 : 0,
        // Then the band. Deliberately BELOW the no-repeat guards rather than
        // above them: the opener is already the best strict-band deal, because
        // the caller sorted the list that way and this walk takes [0] as given,
        // so putting the band above the guards would buy nothing at the top and
        // would cost the one thing the guards exist for. When the only strict
        // deal left repeats the partner on screen, a wider-band deal with a
        // different partner is the better card.
        row.loose,
        // Then how stale the deal is on whichever side has been shown more.
        // Taking the larger of the two keeps both ends fresh instead of trading
        // one kind of repetition for another.
        Math.max(outUses, inUses),
        outUses + inUses,
        partnerUses.get(String(row.partner)) ?? 0,
        -s.score,
      ];
      if (bestKey === null || compareKeys(key, s.key, bestKey, bestTiebreak) < 0) {
        bestKey = key;
        bestTiebreak = s.key;
        bestIndex = i;
      }
    }
    take(bestIndex);
  }

  return [...out, ...tail];
}

/** Lexicographic compare of the ranking key, with the fingerprint last. */
function compareKeys(a: number[], aKey: string, b: number[], bKey: string): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return aKey.localeCompare(bKey);
}

export const ENGINE_LIMITS = {
  MAX_RESULTS,
  COVERAGE_ANCHORS,
  COVERAGE_PER_ANCHOR,
  NAMED_ANCHOR_TAKE,
  DIVERSITY_POOL,
};
