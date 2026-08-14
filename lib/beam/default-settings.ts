/**
 * Code-side fallback for beam_settings (migration 0198).
 *
 * The stored row is the source of truth; this is what BEAM runs on when the row
 * is missing, unreadable, or older than the current shape. Nothing here is a
 * secret and nothing here changes what BEAM can answer, only how sure it has to
 * be before it answers.
 *
 * WHY THESE NUMBERS
 * The two accept thresholds are the whole safety story. A resolver confidence of
 * 0.85 clears exact-name, alias, exact-last-name, and initials matches, and
 * excludes all but the strongest fuzzy matches. The 0.10 margin is what stops
 * BEAM answering for Brock Purdy when someone typed "brock" and Brock Bowers is
 * right behind him. Loosen either and BEAM starts being confidently wrong, which
 * is worse for trust than asking.
 */

import type { CapabilityId } from "./types";

export type BeamSettings = {
  resolver: {
    /** Minimum confidence for the top candidate to be used without asking. */
    acceptConfidence: number;
    /** Minimum gap to the runner-up. Below this, BEAM asks. */
    acceptMargin: number;
    /** Below this the candidate is not even offered as a clarification. */
    clarifyFloor: number;
    /** Candidates within this much of the top are offered as choices. */
    clarifyWindow: number;
    /** Most choices shown at once. More than this is a list, not a question. */
    maxClarifyOptions: number;
    /** pg_trgm similarity floor for tier 6. */
    trigramFloor: number;
    /** Damerau-Levenshtein ceiling on the last name for a fuzzy match. */
    maxEditDistance: number;
  };
  intent: {
    /** Minimum score for the top capability. */
    acceptScore: number;
    /** Minimum gap to the runner-up capability. */
    acceptMargin: number;
  };
  limits: {
    /** Hard cap on question length, enforced before any parsing. */
    maxQuestionLength: number;
    /** Questions per actor per askWindowSeconds. */
    askMaxPerWindow: number;
    askWindowSeconds: number;
    /**
     * Questions from EVERYONE per askGlobalWindowSeconds.
     *
     * The per-actor limit contains one abuser. It does nothing about five
     * hundred addresses asking thirty questions a minute each, which is fifteen
     * thousand a minute arriving at one Postgres instance. This is the ceiling
     * on the whole endpoint, and the number that decides whether a bad day is
     * slow or is an outage.
     *
     * Applied to each pool separately: signed-in readers and guests get this
     * budget each, so a guest flood cannot starve the people who signed in.
     */
    askGlobalMaxPerWindow: number;
    askGlobalWindowSeconds: number;
    /** Learning-request submissions per actor per learnWindowSeconds. */
    learnMaxPerWindow: number;
    learnWindowSeconds: number;
  };
  capabilities: {
    /** Kill switch. A disabled capability is never routed to. */
    disabled: CapabilityId[];
  };
  logging: {
    enabled: boolean;
    /** Days of question log to keep. cleanup_beam_queries() enforces it. */
    retentionDays: number;
  };
  /**
   * Reserved for the LLM interpreter (plan section 17). V1 only ever reads
   * strategy, and only ever finds "deterministic". systemPrompt is here because
   * every AI prompt on this site is DB-backed and admin-editable, and that rule
   * should hold from the first line of the feature rather than be retrofitted.
   */
  interpreter: {
    strategy: "deterministic" | "llm" | "deterministic-then-llm";
    model: string | null;
    systemPrompt: string | null;
  };
};

export const DEFAULT_BEAM_SETTINGS: BeamSettings = {
  resolver: {
    acceptConfidence: 0.85,
    acceptMargin: 0.1,
    clarifyFloor: 0.5,
    clarifyWindow: 0.2,
    maxClarifyOptions: 4,
    trigramFloor: 0.42,
    maxEditDistance: 2,
  },
  intent: {
    acceptScore: 0.55,
    acceptMargin: 0.12,
  },
  limits: {
    maxQuestionLength: 300,
    askMaxPerWindow: 30,
    askWindowSeconds: 60,
    // 600 a minute is 10 a second sustained, which is far above anything this
    // site does today and still well inside what the database can serve: the
    // slowest capability is roughly 900ms, so this bound keeps concurrent heavy
    // work in single figures. Raise it when real traffic justifies it, from the
    // admin, without a deploy.
    askGlobalMaxPerWindow: 600,
    askGlobalWindowSeconds: 60,
    learnMaxPerWindow: 3,
    learnWindowSeconds: 600,
  },
  capabilities: {
    disabled: [],
  },
  logging: {
    enabled: true,
    retentionDays: 180,
  },
  interpreter: {
    strategy: "deterministic",
    model: null,
    systemPrompt: null,
  },
};
