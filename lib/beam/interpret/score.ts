/**
 * Decide which capability a question is asking for.
 *
 * Additive, explicit, and inspectable. Every term below is a number a person can
 * argue with, and the admin debug view shows the breakdown per candidate, which
 * is the whole reason this is not a classifier: when BEAM routes a question
 * wrong, you can see exactly which term did it and change that term.
 *
 * DISQUALIFICATION FIRST. A capability whose required slots are not all filled
 * is removed, not merely scored down. "Who had more targets" with one player
 * named is not a weak comparison, it is not a comparison.
 *
 * NO MARGIN GATE. An earlier design demanded the winner beat the runner-up by a
 * margin before running. That rejected perfectly good questions: "what is faab"
 * scores as a value question about a player called Faab before it scores as a
 * definition, and the two are close. Instead the candidates are TRIED in order
 * and the first one that can actually build a request wins. The value reading
 * fails at player resolution in microseconds and the definition reading answers.
 * Ordered fallthrough beats a threshold because it tests the reading against
 * reality rather than against a number.
 *
 * acceptMargin still does real work: scores are snapped to a grid of that size
 * before sorting, so two readings that are within a margin of each other are
 * ordered by registry position (most specific first) rather than by a difference
 * too small to mean anything.
 */

import type { AnyBeamCapability, BeamSlot } from "@/lib/beam/types";
import type { BeamSettings } from "@/lib/beam/default-settings";
import type { ExtractedEntities } from "./entities";
import type { ConceptTag } from "./lexicon";

export type { ConceptTag };

export type ScoredCapability = {
  capability: AnyBeamCapability;
  score: number;
  /** Human-readable term breakdown for the admin debug view. */
  reasons: string[];
};

const REQUIRED_SLOT_BONUS = 0.15;
const OPTIONAL_SLOT_BONUS = 0.15;
const HEAD_BONUS = 0.25;
const CONCEPT_BONUS = 0.3;
const PLAYER_COUNT_BONUS = 0.15;
const EXTRA_SPAN_PENALTY = 0.3;
const LEFTOVER_TOKEN_PENALTY = 0.2;

/** How many name spans a capability expects to be handed. */
function expectedSpans(capability: AnyBeamCapability): number {
  return capability.matcher.playerCount === 2 ? 2 : 1;
}

/**
 * How many SUBJECTS the question has, which is not always how many name spans
 * it has.
 *
 * A team defense is a player row named "Baltimore Ravens", but the team
 * vocabulary claims "ravens" before name spans are built, so a question about a
 * defense arrives with zero names. Counting teams as subjects when nothing else
 * is available is what keeps every capability from disqualifying itself on a
 * perfectly answerable question. The interpreter applies the same rule when it
 * turns those teams into spans, so the two cannot disagree.
 */
export function subjectCount(entities: ExtractedEntities): number {
  if (entities.nameSpans.length > 0) return entities.nameSpans.length;
  return Math.min(entities.teams.length, 2);
}

function slotFilled(
  slot: BeamSlot,
  entities: ExtractedEntities,
  capability: AnyBeamCapability,
): boolean {
  switch (slot) {
    case "player":
      return subjectCount(entities) >= expectedSpans(capability);
    case "term":
      return entities.nameSpans.length >= 1;
    case "stat":
      return entities.statIds.length >= 1;
    case "season":
      return entities.seasons.length >= 1;
    case "weeks":
      return entities.weeks !== null;
    case "project":
      // A week-range projection is asked for with the verb ("project these
      // weeks") or with the noun ("his projected total for these weeks"), and
      // both should reach it. The week range is what separates this from the
      // rest-of-season projection, not the wording.
      return (
        entities.concepts.includes("project") || entities.concepts.includes("projection")
      );
    case "projection":
      return entities.concepts.includes("projection");
    case "reliability":
      return entities.concepts.includes("reliability");
    case "lens":
      return entities.lens !== null;
    case "position":
      return entities.positions.length >= 1;
    default:
      return false;
  }
}

export function scoreCapabilities(
  capabilities: AnyBeamCapability[],
  entities: ExtractedEntities,
  settings: BeamSettings,
): ScoredCapability[] {
  const conceptSet = new Set(entities.concepts);
  const headSet = new Set(entities.heads);
  const scored: Array<ScoredCapability & { index: number }> = [];

  capabilities.forEach((capability, index) => {
    const matcher = capability.matcher;

    // Disqualify on a missing requirement rather than scoring it down.
    const missing = matcher.required.filter((s) => !slotFilled(s, entities, capability));
    if (missing.length > 0) return;

    const reasons: string[] = [];
    let score = matcher.base;
    reasons.push(`base ${matcher.base.toFixed(2)}`);

    score += REQUIRED_SLOT_BONUS * matcher.required.length;
    reasons.push(`required x${matcher.required.length} +${(REQUIRED_SLOT_BONUS * matcher.required.length).toFixed(2)}`);

    const optionalFilled = matcher.optional.filter((s) => slotFilled(s, entities, capability));
    if (optionalFilled.length > 0) {
      score += OPTIONAL_SLOT_BONUS * optionalFilled.length;
      reasons.push(`optional ${optionalFilled.join("+")} +${(OPTIONAL_SLOT_BONUS * optionalFilled.length).toFixed(2)}`);
    }

    if (matcher.heads.some((h) => headSet.has(h))) {
      score += HEAD_BONUS;
      reasons.push(`head +${HEAD_BONUS.toFixed(2)}`);
    }

    const capabilityConcepts = CAPABILITY_CONCEPTS[capability.id] ?? [];
    if (capabilityConcepts.some((c) => conceptSet.has(c))) {
      score += CONCEPT_BONUS;
      reasons.push(`concept +${CONCEPT_BONUS.toFixed(2)}`);
    }

    // Player-count fit. A one-player capability handed two names is usually the
    // wrong reading of a comparison; a comparison handed two names is the right
    // reading of one.
    if (matcher.playerCount > 0) {
      const wanted = expectedSpans(capability);
      if (subjectCount(entities) === wanted) {
        score += PLAYER_COUNT_BONUS;
        reasons.push(`player count +${PLAYER_COUNT_BONUS.toFixed(2)}`);
      }
      const extra = Math.max(0, subjectCount(entities) - wanted);
      if (extra > 0) {
        score -= EXTRA_SPAN_PENALTY * extra;
        reasons.push(`extra names x${extra} -${(EXTRA_SPAN_PENALTY * extra).toFixed(2)}`);
      }
    }

    if (entities.leftoverTokens.length > 0) {
      const penalty = LEFTOVER_TOKEN_PENALTY * entities.leftoverTokens.length;
      score -= penalty;
      reasons.push(`unaccounted words -${penalty.toFixed(2)}`);
    }

    score = Math.max(0, Math.min(1, score));
    scored.push({ capability, score, reasons, index });
  });

  // Snap to a grid of acceptMargin, then order by specificity within a bucket.
  // Two readings a hundredth apart are not really ranked, and registry order
  // encodes which is the more specific question shape.
  const grid = Math.max(settings.intent.acceptMargin, 0.01);
  scored.sort((a, b) => {
    const bucketA = Math.round(a.score / grid);
    const bucketB = Math.round(b.score / grid);
    if (bucketA !== bucketB) return bucketB - bucketA;
    return a.index - b.index;
  });

  return scored.map(({ capability, score, reasons }) => ({ capability, score, reasons }));
}

/**
 * Which concept words point at which capability.
 *
 * Kept here rather than on the capability so the interpreter never has to import
 * the capability registry, which pulls in Beacon Breakdown and the whole
 * server-side data layer. The interpreter stays pure and testable without a
 * database.
 */
const CAPABILITY_CONCEPTS: Record<string, ConceptTag[]> = {
  "player.value": ["value"],
  "player.rank": ["rank"],
  "player.compare.verdict": ["compare-better"],
  "player.bio": ["bio"],
  "player.stat.line": ["line"],
  "player.weeks.projection": ["project", "projection"],
  "player.projection": ["projection"],
  "player.compare.projection": ["projection"],
  "player.reliability": ["reliability"],
  "player.compare.reliability": ["reliability"],
  "glossary.term": ["define"],
};
