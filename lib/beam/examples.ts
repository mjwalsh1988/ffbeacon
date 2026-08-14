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
 * A short, varied starter set for the empty state: one example from each live
 * capability, so the reader sees the breadth rather than four ways to ask the
 * same thing.
 */
export function starterExamples(
  disabled: readonly CapabilityId[] = [],
  limit = 5,
): string[] {
  const live = enabledCapabilities(disabled);
  // Deliberately NOT registry order. That list is ordered by specificity, so
  // ties between two capabilities that both fit a question break correctly, and
  // it now begins with the narrowest shapes we answer. Those make poor first
  // impressions: someone opening BEAM for the first time should be offered the
  // question they already have, not the cleverest one we handle. Anything not
  // named here still appears, after these, in registry order.
  const priority: CapabilityId[] = [
    "player.season.stat",
    "player.compare.verdict",
    "player.value",
    "player.compare.stat",
    "player.reliability",
    "player.projection",
    "glossary.term",
  ];
  const rank = (id: CapabilityId) => {
    const index = priority.indexOf(id);
    return index === -1 ? priority.length : index;
  };
  const ordered = [...live].sort((a, b) => rank(a.id) - rank(b.id));

  const out: string[] = [];
  for (const capability of ordered) {
    if (capability.examples.length > 0) out.push(capability.examples[0]);
    if (out.length >= limit) break;
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
