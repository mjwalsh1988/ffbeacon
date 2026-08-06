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
 * VARIETY IS A FEATURE, NOT A FINISHING TOUCH
 *   Steps 3, 4 and 6 all exist because of the same production failure. Asked for
 *   twelve ideas, the engine returned twelve different players coming back for
 *   the same two or three going out, and in the worst real league three distinct
 *   payments across all twelve. A manager reading that has been handed one idea
 *   twelve times. The reader is here for somewhere to start, so a slightly worse
 *   deal they have not thought of beats a slightly better variant of the deal
 *   above it, and the ordering says so explicitly.
 *
 * Cost is bounded at every level rather than by a timeout. A twelve-team league
 * evaluates eleven counterparties, at most ten acquirable pieces each, and at
 * most three packages per piece, plus one anchored search per uncovered asset,
 * so the ceiling is a few hundred candidate deals and roughly twice that many
 * lineup fills. That is a fraction of a second, and it does not grow with the
 * size of the site.
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
  PACKAGE_LIMITS,
  acquirablePool,
  anchorCandidates,
  anchorOf,
  assetId,
  assetValue,
  balancePackages,
  givablePool,
  incomingPairs,
  type AssetRef,
  type QualityGate,
} from "./packages";
import { DEFAULT_TRADE_QUALITY_CONFIG } from "@/lib/trade-quality";
import {
  acceptanceOf,
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
  buildWhyThem,
  buildWhyYou,
} from "./explain";
import { suggestionKey } from "./fingerprint";
import type {
  SuggestionAsset,
  TradeFinderInput,
  TradeFinderResult,
  TradeSuggestion,
} from "./types";

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

/** A need this size is worth naming in the explanation. Points per week. */
const NAMEABLE_NEED = 0.5;

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
function positionHelped(incoming: AssetRef[], mine: TeamProfile): string | null {
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
  return best;
}

export function findTrades(input: TradeFinderInput): TradeFinderResult {
  const empty: TradeFinderResult = {
    suggestions: [],
    consideredTeams: 0,
    lineupUnavailable: false,
  };

  const myTeam = input.teams.find((t) => t.rosterId === input.myRosterId);
  if (!myTeam) return empty;

  const slots = input.startingSlots;
  const baselines = leagueStarterBaselines(input.teams, slots);
  const profiles = input.teams.map((team) => buildTeamProfile(team, slots, baselines));
  const mine = profiles.find((p) => p.team.rosterId === input.myRosterId);
  if (!mine) return empty;

  const lineupUnavailable = profiles.every((p) => p.startingTotal === null);
  const excluded = new Set(input.excludeKeys);

  // The reader's own currency is the same whoever they are talking to, so it is
  // assembled once rather than per counterparty.
  const givable = givablePool(mine, {
    goal: input.goal,
    offerPlayerId: input.offerPlayerId,
    allowPicks: input.allowPicks,
  });
  const required = input.offerPlayerId
    ? (givable.find((a) => assetId(a) === input.offerPlayerId) ?? null)
    : null;

  // A named player the reader wants to move but that we cannot find, or cannot
  // value, leaves nothing honest to build from.
  if (input.offerPlayerId && !required) return { ...empty, lineupUnavailable };
  if (givable.length === 0) return { ...empty, lineupUnavailable };

  // The consolidation model, on admin settings when the caller loaded them and
  // on the published defaults when it did not. Either way the finder and Signal
  // Check are reading from the same curve, which is what stops the suggestion
  // and the grade printed beneath it from arguing.
  const quality = {
    config: input.quality?.config ?? DEFAULT_TRADE_QUALITY_CONFIG,
    poolMax: input.quality?.poolMax ?? null,
  };

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
  const acquirableByRoster = new Map<number, AssetRef[]>();
  /** Counterparties with something on the table, in either pass. */
  const considered = new Set<number>();

  const note = (tally: Map<string, number>, assets: AssetRef[]) => {
    for (const a of assets) {
      const id = assetId(a);
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

    const myImpact = measureImpact(mine, slots, incoming, outgoing);
    // The other team's ledger is this one reversed: what the reader sends is
    // what they receive.
    const theirImpact = measureImpact(theirs, slots, outgoing, incoming);

    // The goal is a constraint. A reader who asked for picks and is shown a
    // deal without one has been ignored, however good it is. A named target
    // overrides it, because naming a player IS the more specific request.
    if (
      !input.targetPlayerId &&
      !satisfiesGoal(input.goal, myImpact, {
        incoming: incoming.length,
        outgoing: outgoing.length,
      })
    ) {
      return null;
    }

    const gap = valueGapOf(incoming, outgoing);
    const qualityRatio = qualityRatioOf(incoming, outgoing, quality);
    const acceptance = acceptanceOf(theirImpact, theirs, gap, qualityRatio);
    const score = scoreSuggestion({
      mine: myImpact,
      myProfile: mine,
      acceptance,
      goal: input.goal,
    });

    // A deal that does nothing for the reader is not a suggestion.
    if (score <= 0 && !input.targetPlayerId && !opts.allowNeutral) return null;

    seenKeys.add(key);

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
      whyYou: buildWhyYou(myImpact, input.goal, helped),
      whyThem: buildWhyThem(
        theirImpact,
        theirs.direction,
        theirs.team.teamName,
        theirs.team.statusLabel,
      ),
      pitch: buildPitch({
        outgoing: outgoingAssets,
        incoming: incomingAssets,
        theirs: theirImpact,
        direction: theirs.direction,
        valueGap: gap,
      }),
      caveats: buildCaveats({
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

  for (const theirs of profiles) {
    if (theirs.team.rosterId === input.myRosterId) continue;

    const acquirable = acquirablePool(theirs, mine, {
      goal: input.goal,
      targetPlayerId: input.targetPlayerId,
      allowPicks: input.allowPicks,
    });
    acquirableByRoster.set(theirs.team.rosterId, acquirable);
    if (acquirable.length === 0) continue;
    considered.add(theirs.team.rosterId);

    // What the reader might receive: one piece at a time, plus genuine pairs
    // when they have asked to turn a name into depth.
    const incomingSets: AssetRef[][] = acquirable.map((a) => [a]);
    if (input.goal === "add-depth" && required) {
      incomingSets.push(
        ...incomingPairs(
          acquirable,
          assetValue(required),
          PACKAGE_LIMITS.QUALITY_RAW_OVER_TOLERANCE,
        ),
      );
    }

    for (const incoming of incomingSets) {
      const target = incoming.reduce(
        (sum, a) => sum + (a.kind === "player" ? a.player.value : a.pick.value),
        0,
      );
      if (target <= 0) continue;

      const gate: QualityGate = {
        config: quality.config,
        poolMax: quality.poolMax,
        incomingValues: incoming.map(assetValue),
      };
      const packages = balancePackages(target, givable, {
        required,
        maxAssets: input.goal === "consolidate" ? 3 : undefined,
        quality: gate,
        usage: outgoingUsage,
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
   * So each unmentioned asset anchors its own search, with the deal built
   * around it instead of it being built around somebody else. The fairness
   * bands are the same ones every other suggestion passes, so an idea that
   * cannot come back level is still not shown. What changes is only which
   * question gets asked.
   */
  const specificAsk = Boolean(input.targetPlayerId || input.offerPlayerId);
  if (!specificAsk) {
    const mentioned = new Set<string>();
    for (const s of suggestions) {
      for (const a of s.outgoing) mentioned.add(a.kind === "player" ? a.playerId : a.key);
    }

    const anchors = anchorCandidates(mine, {
      goal: input.goal,
      allowPicks: input.allowPicks,
    })
      .filter((a) => !mentioned.has(assetId(a)))
      .slice(0, COVERAGE_ANCHORS);

    for (const anchor of anchors) {
      const anchorValue = assetValue(anchor);
      if (anchorValue <= 0) continue;
      const found: TradeSuggestion[] = [];

      for (const theirs of profiles) {
        if (theirs.team.rosterId === input.myRosterId) continue;
        // Recomputed rather than reused: a comparable piece on their side is
        // only on the table because the reader is putting up an equal one, so
        // it depends on this anchor and cannot be cached across anchors.
        const pool = acquirablePool(theirs, mine, {
          goal: input.goal,
          targetPlayerId: null,
          allowPicks: input.allowPicks,
          comparableTo: anchorValue,
        });
        if (pool.length === 0) continue;
        // A team with nothing spare can still have somebody the reader can
        // match, so this pass reaches counterparties the browse loop skipped.
        considered.add(theirs.team.rosterId);

        // Sides swapped: the fixed side is what the reader SENDS, and the
        // package being assembled is what comes back.
        const gate: QualityGate = {
          config: quality.config,
          poolMax: quality.poolMax,
          incomingValues: [anchorValue],
          reversed: true,
        };
        const returns = balancePackages(anchorValue, pool, {
          quality: gate,
          usage: incomingUsage,
        });

        for (const incoming of returns) {
          const suggestion = build(theirs, incoming, [anchor], { allowNeutral: true });
          if (suggestion) found.push(suggestion);
        }
      }

      found.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
      const kept = found.slice(0, COVERAGE_PER_ANCHOR);
      for (const s of kept) {
        suggestions.push(s);
        note(outgoingUsage, [anchor]);
      }
    }
  }

  // A target the reader has already refused sinks below everything they have
  // not seen. Score decides inside each band, then the fingerprint. The tiebreak
  // is not cosmetic: two deals that score identically must come back in the same
  // order on every run, or a pass would move the goalposts instead of advancing
  // the queue.
  suggestions.sort((a, b) => {
    const aPassed = passedTargets.has(targetKeyOf(a)) ? 1 : 0;
    const bPassed = passedTargets.has(targetKeyOf(b)) ? 1 : 0;
    if (aPassed !== bPassed) return aPassed - bPassed;
    return b.score - a.score || a.key.localeCompare(b.key);
  });

  return {
    suggestions: selectVaried(suggestions, (s) =>
      passedTargets.has(targetKeyOf(s)),
    ).slice(0, MAX_RESULTS),
    consideredTeams: considered.size,
    lineupUnavailable,
  };
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

/** The player or players coming back, regardless of who is sending them. */
function incomingKeyOf(s: TradeSuggestion): string {
  return s.incoming
    .map((a) => (a.kind === "player" ? a.playerId : a.key))
    .sort()
    .join(",");
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
 * directly before it, on either the asset or the partner, while an alternative
 * exists. Among the rest it is whichever repeats least of everything shown so
 * far, and only then the better score. Freshness beats a better deal on purpose.
 * The reader is being handed ideas to build on, and the eighth variant of one
 * idea is worth less to them than the first version of a new one.
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
): TradeSuggestion[] {
  if (sorted.length <= 2) return sorted;

  const remaining = sorted.slice(0, DIVERSITY_POOL);
  const tail = sorted.slice(DIVERSITY_POOL);
  const out: TradeSuggestion[] = [];

  const outgoingUses = new Map<string, number>();
  const incomingUses = new Map<string, number>();
  const partnerUses = new Map<string, number>();

  let lastOutgoing: string | null = null;
  let lastPartner: number | null = null;

  const take = (index: number) => {
    const [next] = remaining.splice(index, 1);
    out.push(next);
    bump(outgoingUses, paymentKeyOf(next));
    bump(incomingUses, incomingKeyOf(next));
    bump(partnerUses, String(next.counterparty.rosterId));
    lastOutgoing = paymentKeyOf(next);
    lastPartner = next.counterparty.rosterId;
  };

  take(0);

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestKey: number[] | null = null;
    let bestTiebreak = "";

    for (let i = 0; i < remaining.length; i += 1) {
      const s = remaining[i];
      const outKey = paymentKeyOf(s);
      const inKey = incomingKeyOf(s);
      const outUses = outgoingUses.get(outKey) ?? 0;
      const inUses = incomingUses.get(inKey) ?? 0;
      const key = [
        isPassed(s) ? 1 : 0,
        // Never twice in a row, on either axis, while any alternative exists.
        // These outrank the tallies below because two identical cards back to
        // back is the failure a reader notices first, and because keeping both
        // guards inside ONE key is what stops them undoing each other the way
        // the separate passes did.
        outKey === lastOutgoing ? 1 : 0,
        s.counterparty.rosterId === lastPartner ? 1 : 0,
        // Then how stale the deal is on whichever side has been shown more.
        // Taking the larger of the two keeps both ends fresh instead of trading
        // one kind of repetition for another.
        Math.max(outUses, inUses),
        outUses + inUses,
        partnerUses.get(String(s.counterparty.rosterId)) ?? 0,
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
  DIVERSITY_POOL,
};
