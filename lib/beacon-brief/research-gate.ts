/**
 * The decision half of the research gate, with no IO in it.
 *
 * Research is the most expensive call the Brief makes. The web_search loop runs
 * on Anthropic's servers and re-bills the whole accumulated conversation every
 * round, so one article's research averaged 126,553 input tokens and the stage
 * was 95% of the monthly bill. Plenty of those calls bought nothing: when a
 * reporter posts the full terms of a trade, the search returns the facts the
 * post already stated. So the pipeline asks first, on the cheap model.
 *
 * The decision lives here rather than inline in ./worker.ts because it has one
 * property worth pinning down in tests, and it cannot be tested where it sits:
 * EVERY path that is not a clear "the post already says it all" must research.
 * A wrong skip is not a cheaper article, it is an article written from whatever
 * the model happens to remember, which is the failure migration 0179 exists
 * because of. ./research-gate.test.ts enumerates the paths.
 */

/** What the triage model answers. Both fields are required by the schema. */
export interface ResearchGateVerdict {
  needs_research: boolean;
  reason: string;
}

export interface ResearchGateInput {
  /** bb_research_gate_enabled. Off restores the pre-0186 behaviour. */
  gateEnabled: boolean;
  /** Characters of usable text in the post, links and handles stripped. */
  postChars: number;
  /** bb_research_gate_min_post_chars. Below this the gate is not consulted. */
  minPostChars: number;
  /** bb_research_gate_prompt. An empty prompt means the gate cannot run. */
  gatePrompt: string;
}

export type ResearchDecision =
  | { research: true; why: "gate_off" | "no_prompt" | "post_too_short" }
  | { research: true; why: "ask_model" };

/**
 * What to do before the model has been asked.
 *
 * Returns `ask_model` only when the gate is on, configured, and the post is long
 * enough to be worth asking about. Every other answer researches without
 * spending anything on the gate.
 */
export function researchPrecheck(input: ResearchGateInput): ResearchDecision {
  if (!input.gateEnabled) return { research: true, why: "gate_off" };
  if (!input.gatePrompt) return { research: true, why: "no_prompt" };
  // The floor matters more than the gate itself. A thin post is the one case
  // where skipping is dangerous rather than merely cheaper: it hands the writer
  // a fragment and nothing else. The gate never gets to make that call.
  if (input.postChars < input.minPostChars) {
    return { research: true, why: "post_too_short" };
  }
  return { research: true, why: "ask_model" };
}

/**
 * Whether the model's answer permits skipping research.
 *
 * Deliberately not a truthiness check. `null` is a failed or unparseable call,
 * and a missing field parses to `undefined`. Neither is a "no", so both must
 * read as "research". Only an explicit `false` skips.
 */
export function verdictAllowsSkip(
  verdict: ResearchGateVerdict | null,
): boolean {
  return verdict?.needs_research === false;
}
