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
 *   4. Measure what each offer does to BOTH teams.
 *   5. Rank on what it does for the reader, discounted by whether the other
 *      manager would take it.
 *
 * Step 4 is the one most trade tools skip, and it is why this one can say
 * something better than "these numbers are close". Step 5 is why the top
 * suggestion is usually modest: an offer that would be refused is worth less
 * than a smaller one that gets accepted.
 *
 * Cost is bounded at every level rather than by a timeout. A twelve-team league
 * evaluates eleven counterparties, at most ten acquirable pieces each, and at
 * most three packages per piece, so the ceiling is a few hundred candidate deals
 * and roughly twice that many lineup fills. That is a fraction of a second, and
 * it does not grow with the size of the site.
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
  acquirablePool,
  assetId,
  assetValue,
  balancePackages,
  givablePool,
  incomingPairs,
  type AssetRef,
} from "./packages";
import {
  acceptanceOf,
  measureImpact,
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
  let consideredTeams = 0;

  for (const theirs of profiles) {
    if (theirs.team.rosterId === input.myRosterId) continue;

    const acquirable = acquirablePool(theirs, mine, {
      goal: input.goal,
      targetPlayerId: input.targetPlayerId,
      allowPicks: input.allowPicks,
    });
    if (acquirable.length === 0) continue;
    consideredTeams += 1;

    // What the reader might receive: one piece at a time, plus genuine pairs
    // when they have asked to turn a name into depth.
    const incomingSets: AssetRef[][] = acquirable.map((a) => [a]);
    if (input.goal === "add-depth" && required) {
      incomingSets.push(...incomingPairs(acquirable, assetValue(required)));
    }

    for (const incoming of incomingSets) {
      const target = incoming.reduce(
        (sum, a) => sum + (a.kind === "player" ? a.player.value : a.pick.value),
        0,
      );
      if (target <= 0) continue;

      const packages = balancePackages(target, givable, {
        required,
        maxAssets: input.goal === "consolidate" ? 3 : undefined,
      });

      const groupKey = targetKey(theirs.team.rosterId, incoming);

      for (const outgoing of packages) {
        const key = suggestionKey({
          counterpartyRosterId: theirs.team.rosterId,
          incoming: incoming.map(toSuggestionAsset),
          outgoing: outgoing.map(toSuggestionAsset),
        });
        if (seenKeys.has(key)) continue;
        if (excluded.has(key)) {
          passedTargets.add(groupKey);
          continue;
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
          continue;
        }

        const gap = valueGapOf(incoming, outgoing);
        const acceptance = acceptanceOf(theirImpact, theirs, gap);
        const score = scoreSuggestion({
          mine: myImpact,
          myProfile: mine,
          acceptance,
          goal: input.goal,
        });

        // A deal that does nothing for the reader is not a suggestion. The one
        // exception is a named target: they asked what it would take, and the
        // answer is worth having even when the arithmetic is against them.
        if (score <= 0 && !input.targetPlayerId) continue;

        seenKeys.add(key);

        const incomingAssets = incoming.map(toSuggestionAsset);
        const outgoingAssets = outgoing.map(toSuggestionAsset);
        const helped = positionHelped(incoming, mine);

        suggestions.push({
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
        });
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
    suggestions: spreadByTarget(suggestions).slice(0, MAX_RESULTS),
    consideredTeams,
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

/**
 * Reorder so consecutive suggestions are for different players.
 *
 * The engine builds up to three packages for the same target, and on a real
 * league they come out adjacent because they score almost identically: the same
 * player, from the same team, for a slightly different set of pieces. On a list
 * that is fine. On a surface that shows one deal at a time it is the difference
 * between a pass that moves you along and a pass that appears to do nothing,
 * which is what it looked like against a production league before this existed.
 *
 * So the best offer for each target goes first, in score order, then the second
 * offer for each, and so on. Nothing is dropped: a reader who passes on every
 * distinct player still reaches the alternative ways of paying for the first
 * one. They just do not have to wade through them to see the second player.
 *
 * Stable, because the input is already sorted and the grouping walk preserves
 * that order within and across groups.
 */
function spreadByTarget(sorted: TradeSuggestion[]): TradeSuggestion[] {
  const groups = new Map<string, TradeSuggestion[]>();
  for (const s of sorted) {
    const key = targetKeyOf(s);
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  const lists = [...groups.values()];
  const out: TradeSuggestion[] = [];
  for (let round = 0; out.length < sorted.length; round += 1) {
    let added = false;
    for (const list of lists) {
      if (round < list.length) {
        out.push(list[round]);
        added = true;
      }
    }
    // Nothing left to take. Guards against an infinite loop if the accounting
    // above ever disagrees with the input length.
    if (!added) break;
  }
  return out;
}

export const ENGINE_LIMITS = { MAX_RESULTS };
