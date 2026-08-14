/**
 * The example questions BEAM shows.
 *
 * Generated from the capability registry rather than hand-written, and that is
 * the point. A suggestion chip offering a question BEAM cannot answer costs more
 * than the chip is worth: the reader tries it, it fails, and every other answer
 * on the page loses credibility. Deriving them from the registry means a
 * capability that gets switched off in beam_settings stops being advertised in
 * the same request, with nobody having to remember.
 */

import { CAPABILITIES, enabledCapabilities } from "./capabilities";
import type { CapabilityId } from "./types";

/** Every example from every live capability, in registry order. */
export function allExamples(disabled: readonly CapabilityId[] = []): string[] {
  return enabledCapabilities(disabled).flatMap((c) => c.examples);
}

/**
 * Reading order, which is NOT registry order.
 *
 * The registry is ordered by specificity so that ties between two capabilities
 * that both fit a question break correctly, and it therefore begins with the
 * narrowest shapes we answer. Those make a poor first impression: someone
 * opening BEAM should be offered the question they already have, not the
 * cleverest one we handle. Anything not named here still appears, after these,
 * in registry order.
 */
const READER_PRIORITY: CapabilityId[] = [
  "player.season.stat",
  "rankings.top",
  "draft.board",
  "player.compare.verdict",
  "player.value",
  "player.compare.stat",
  "player.reliability",
  "player.projection",
  "glossary.term",
];

/**
 * Sort capabilities the way a reader should meet them. Shared by the starter
 * chips and by the "what can I ask" answer, so the two can never disagree about
 * which questions matter most.
 */
export function orderForReaders<T extends { id: CapabilityId }>(
  capabilities: readonly T[],
): T[] {
  const rank = (id: CapabilityId) => {
    const index = READER_PRIORITY.indexOf(id);
    return index === -1 ? READER_PRIORITY.length : index;
  };
  // Sort is stable, so everything unranked keeps registry order behind the rest.
  return [...capabilities].sort((a, b) => rank(a.id) - rank(b.id));
}

/**
 * A short, varied starter set for the empty state: one example from each live
 * capability, so the reader sees the breadth rather than four ways to ask the
 * same thing.
 *
 * "What type of questions can I ask?" ALWAYS LEADS, when that capability is
 * live. Four chips can only ever show four questions, and a reader who takes
 * them for the whole menu never discovers the rest. The first chip answers that
 * directly, with the full list built from the registry, so the menu is one tap
 * away instead of being something to infer from a sample.
 */
export function starterExamples(
  disabled: readonly CapabilityId[] = [],
  limit = 5,
): string[] {
  const live = enabledCapabilities(disabled);
  const help =
    live.find((c) => c.id === "help.capabilities")?.examples[0] ?? null;
  const ordered = orderForReaders(
    live.filter((c) => c.id !== "help.capabilities"),
  );

  const out: string[] = help ? [help] : [];
  for (const capability of ordered) {
    if (out.length >= limit) break;
    if (capability.examples.length > 0) out.push(capability.examples[0]);
  }
  return out;
}

/**
 * What to offer after a dead end. Deliberately different from the starter set:
 * a reader who just failed does not need the same four suggestions they already
 * ignored, they need proof that something works.
 */
export function recoveryExamples(
  disabled: readonly CapabilityId[] = [],
  limit = 4,
): string[] {
  const pool = allExamples(disabled);
  const starters = new Set(starterExamples(disabled));
  const fresh = pool.filter((e) => !starters.has(e));
  return (fresh.length >= limit ? fresh : pool).slice(0, limit);
}

/** Admin-facing summary of what BEAM currently claims it can do. */
export function capabilitySummary(): Array<{
  id: CapabilityId;
  label: string;
  description: string;
  examples: string[];
}> {
  return CAPABILITIES.map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description,
    examples: [...c.examples],
  }));
}
