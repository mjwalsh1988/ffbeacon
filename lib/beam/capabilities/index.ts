/**
 * The capability registry: the single place a question type is registered.
 *
 * Adding a question type to BEAM is four edits and no more:
 *   1. a capability module next to this one
 *   2. its id in CAPABILITY_IDS (lib/beam/types.ts)
 *   3. its phrasings in the lexicon, if it needs new vocabulary
 *   4. one line here
 *
 * The route, the interpreter core, the scorer, the answer card, and the admin
 * kill-switch list all read from this array, so none of them need touching. That
 * property is the point of the whole shape, and it is also what makes the future
 * LLM layer a one-file change: the model's tool schema is generated from this
 * same array, so a capability added today is available to the model the day it
 * is switched on.
 *
 * ORDER MATTERS a little. The scorer breaks exact ties by array position, so the
 * more specific capabilities come first. Ties are rare, because the matchers
 * differ on player count and required slots.
 */

import type { AnyBeamCapability, CapabilityId } from "@/lib/beam/types";
import { playerCompareVerdict } from "./player-compare-verdict";
import { playerCompareStat } from "./player-compare-stat";
import { playerSeasonStat } from "./player-season-stat";
import { playerWeeksProjection } from "./player-weeks-projection";
import { playerProjection } from "./player-projection";
import { rankingsTop } from "./rankings-top";
import { playerCompareProjection } from "./player-compare-projection";
import { playerReliability } from "./player-reliability";
import { playerCompareReliability } from "./player-compare-reliability";
import { playerStatLine } from "./player-stat-line";
import { playerValue } from "./player-value";
import { playerRank } from "./player-rank";
import { playerBio } from "./player-bio";
import { glossaryTerm } from "./glossary-term";
import { helpCapabilities } from "./help-capabilities";
import { draftBoard } from "./draft-board";

// MOST SPECIFIC FIRST. Scores clamp at 1.00, so two capabilities that both fit
// a question routinely tie, and a tie is broken by position here. The ones that
// demand a concept word of their own (beat rate, projection, projected pace) go
// above the general comparison, because "who has the better beat rate, A or B"
// fits the head-to-head verdict just as well and the verdict would answer a
// different question with total confidence.
//
// Two-player forms sit above their single-player siblings for the same reason:
// both are viable when a question names two people, and the pair is the more
// specific reading.
export const CAPABILITIES: AnyBeamCapability[] = [
  // "What can I ask" is first because it is about BEAM rather than about
  // football: no player, no stat, no season, and nothing else can be confused
  // with it.
  helpCapabilities as unknown as AnyBeamCapability,
  // The draft board names no player either, and its words ("steals", "avoid")
  // sit close enough to a value question that the more specific reading has to
  // win the tie.
  draftBoard as unknown as AnyBeamCapability,
  // Then: it is the only capability that answers with no player named at all,
  // so nothing else can be confused with it, and a bare "top 10 quarterbacks"
  // otherwise scores as a question about a player called Quarterbacks.
  rankingsTop as unknown as AnyBeamCapability,
  playerCompareReliability as unknown as AnyBeamCapability,
  playerCompareProjection as unknown as AnyBeamCapability,
  playerWeeksProjection as unknown as AnyBeamCapability,
  playerReliability as unknown as AnyBeamCapability,
  playerProjection as unknown as AnyBeamCapability,
  playerCompareStat as unknown as AnyBeamCapability,
  playerCompareVerdict as unknown as AnyBeamCapability,
  playerSeasonStat as unknown as AnyBeamCapability,
  playerValue as unknown as AnyBeamCapability,
  playerRank as unknown as AnyBeamCapability,
  playerStatLine as unknown as AnyBeamCapability,
  playerBio as unknown as AnyBeamCapability,
  glossaryTerm as unknown as AnyBeamCapability,
];

const BY_ID = new Map<CapabilityId, AnyBeamCapability>(
  CAPABILITIES.map((c) => [c.id, c]),
);

export function getCapability(id: CapabilityId): AnyBeamCapability | null {
  return BY_ID.get(id) ?? null;
}

/** Capabilities the admin has not switched off. */
export function enabledCapabilities(
  disabled: readonly CapabilityId[],
): AnyBeamCapability[] {
  if (disabled.length === 0) return CAPABILITIES;
  const off = new Set(disabled);
  return CAPABILITIES.filter((c) => !off.has(c.id));
}

export {
  helpCapabilities,
  draftBoard,
  rankingsTop,
  playerWeeksProjection,
  playerProjection,
  playerCompareProjection,
  playerReliability,
  playerCompareReliability,
  playerCompareStat,
  playerCompareVerdict,
  playerSeasonStat,
  playerStatLine,
  playerValue,
  playerRank,
  playerBio,
  glossaryTerm,
};
