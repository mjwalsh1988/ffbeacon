/**
 * BEAM's one entry point: a question in, an outcome out.
 *
 *   interpret -> run the capability -> present -> log
 *
 * The route handler above this does transport concerns (origin, rate limit,
 * shape) and nothing else. Everything about what BEAM knows lives below here,
 * which is what lets the same engine be called from a page, a route, or a test
 * without any of them re-implementing the sequence.
 *
 * ERRORS NEVER ESCAPE. A capability that throws becomes an unsupported outcome
 * with a friendly message and an error row in the log. An assistant that returns
 * a 500 has told the reader nothing; an assistant that says "we could not work
 * that one out" and offers the feedback button has at least closed the loop.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getCapability } from "./capabilities";
import { deterministicInterpreter } from "./interpret";
import { recoveryExamples } from "./examples";
import { logBeamQuery } from "./log";
import type {
  BeamContext,
  BeamLink,
  BeamOutcome,
  BeamUnsupportedReason,
  CapabilityId,
} from "./types";

/**
 * Copy for every way BEAM can fail to answer. One reason, one message.
 *
 * These are deliberately different from each other. "We could not find that
 * player" and "BEAM cannot see your league" describe different problems and
 * imply different next steps, and collapsing them into one polite shrug is what
 * makes an assistant feel like it is not listening.
 */
const UNSUPPORTED_MESSAGE: Record<BeamUnsupportedReason, string> = {
  "no-player":
    "We could not find a player by that name. Check the spelling, or try their full name.",
  "no-intent": "BEAM does not know how to answer that one yet.",
  "unsupported-stat":
    "We do not track that statistic yet. Here are some things BEAM can look up.",
  "no-data": "We do not hold data for that season.",
  "out-of-scope":
    "BEAM cannot see your league yet, so it cannot answer questions about your roster or your matchups.",
  "not-ranked":
    "That player is not currently ranked, so we have no live value or ranking for him. Season stats still work.",
  "too-many-players": "BEAM can handle two players at a time. Try asking about a pair.",
  "capability-disabled": "That kind of question is switched off right now.",
  error: "Something went wrong working that one out.",
};

/**
 * Where a dead end should send the reader instead. A question BEAM cannot answer
 * that another FF Beacon tool CAN answer is not really a dead end, and leaving
 * the reader to find that tool themselves would be the unhelpful choice.
 */
const UNSUPPORTED_LINKS: Partial<Record<BeamUnsupportedReason, BeamLink[]>> = {
  "out-of-scope": [
    { href: "/tools/league-pulse", label: "Sync your league in League Pulse" },
    { href: "/tools/signal-check", label: "Grade a trade in Signal Check" },
  ],
  "unsupported-stat": [{ href: "/rankings", label: "Browse the rankings board" }],
};

/**
 * Every dead end is built here, so message, suggestions, and onward links can
 * never drift apart between the four places that produce one.
 */
function unsupported(
  reason: BeamUnsupportedReason,
  disabled: readonly CapabilityId[],
  messageOverride?: string,
): Extract<BeamOutcome, { kind: "unsupported" }> {
  return {
    kind: "unsupported",
    reason,
    message: messageOverride ?? UNSUPPORTED_MESSAGE[reason],
    suggestions: recoveryExamples(disabled),
    links: UNSUPPORTED_LINKS[reason] ?? [],
    queryId: null,
  };
}

export type AskOptions = {
  /** Salted actor hash from the rate limiter. Never a raw IP. */
  actorHash?: string | null;
  userId?: string | null;
  /** Skip the log write. Used by tests and the admin preview. */
  skipLogging?: boolean;
};

export type AskResult = {
  outcome: BeamOutcome;
  /** Score breakdown per candidate reading. Admin debug only, never public. */
  trace: Array<{ capability: string; score: number; reasons: string[] }>;
  latencyMs: number;
};

export async function ask(
  question: string,
  ctx: BeamContext,
  options: AskOptions = {},
): Promise<AskResult> {
  const startedAt = Date.now();
  const disabled = ctx.settings.capabilities.disabled;

  let outcome: BeamOutcome;
  let trace: AskResult["trace"] = [];
  let normalized = "";
  let capabilityId: CapabilityId | null = null;
  let confidence: number | null = null;
  let playerIds: string[] = [];
  let failureReason: string | null = null;

  try {
    const interpreted = await deterministicInterpreter.interpretVerbose(question, ctx);
    trace = interpreted.trace;
    normalized = interpreted.normalized;

    if (interpreted.interpretation.kind === "clarify") {
      outcome = {
        kind: "clarify",
        clarification: interpreted.interpretation.clarification,
        queryId: null,
      };
    } else if (interpreted.interpretation.kind === "unsupported") {
      failureReason = interpreted.interpretation.reason;
      outcome = unsupported(interpreted.interpretation.reason, disabled);
    } else {
      const request = interpreted.interpretation.request;
      capabilityId = request.capability;
      confidence = request.confidence;
      playerIds = interpreted.matchedPlayers.map((p) => p.playerId);

      const capability = getCapability(request.capability);
      if (!capability) {
        failureReason = "capability-disabled";
        outcome = unsupported("capability-disabled", disabled);
      } else {
        // The capability parsed these params itself during interpretation, so
        // the cast is re-asserting a fact rather than assuming one.
        const params = request.params as never;
        const result = await capability.run(params, ctx);

        if (result === null) {
          // The capability declined. A decline is a dead end, so it renders as
          // an unsupported card with the feedback button rather than as an
          // answer whose content is an apology.
          failureReason = "no-data";
          outcome = unsupported("no-data", disabled, capability.declineMessage);
        } else {
          const answer = capability.present(result as never, params, ctx);
          outcome = {
            kind: "answer",
            answer,
            capability: request.capability,
            confidence: request.confidence,
            matchedPlayers: interpreted.matchedPlayers,
            queryId: null,
          };
        }
      }
    }
  } catch (err) {
    console.error("[beam] ask failed", err);
    failureReason = "error";
    outcome = unsupported("error", disabled);
  }

  const latencyMs = Date.now() - startedAt;

  if (!options.skipLogging && ctx.settings.logging.enabled) {
    const queryId = await logBeamQuery(ctx.admin, {
      question,
      questionNormalized: normalized,
      outcome: outcome.kind === "answer" ? "answer" : outcome.kind,
      capabilityId,
      failureReason,
      confidence,
      playerIds,
      formatSlug: ctx.formatSlug,
      sourceSlug: ctx.sourceSlug,
      latencyMs,
      actorHash: options.actorHash ?? null,
      userId: options.userId ?? null,
    });
    // The id travels back so the feedback form can attach itself to this exact
    // parse without the client having to re-send the question.
    outcome = { ...outcome, queryId } as BeamOutcome;
  }

  return { outcome, trace, latencyMs };
}

/** Convenience for callers that already have both clients. */
export type BeamClients = {
  supabase: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
};
