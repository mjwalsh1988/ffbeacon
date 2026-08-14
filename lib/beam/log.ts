/**
 * Write one row per question to beam_queries, and scrub it on the way in.
 *
 * WHY LOG AT ALL. The most useful artefact BEAM produces in its first month is
 * the list of questions it could not answer, ordered by how often people asked
 * them. That list decides what gets built next, and it cannot come from the
 * feedback form because almost nobody fills in a form.
 *
 * WHY SCRUB. This is free text a stranger typed into a box. Most of it is "how
 * many yards did purdy throw for", and some small fraction of it will contain an
 * email address, a phone number, or something else nobody intended to file with
 * us. Redaction happens here, before the insert, because a scrubber that runs
 * anywhere later is a scrubber that has already failed.
 *
 * WHAT IS NOT STORED. No raw IP: actor_hash is the salted hash the rate limiter
 * already computed, which is not reversible and cannot be rotated by the caller.
 * The retention window is enforced in the database by cleanup_beam_queries().
 *
 * NEVER THROWS. A logging failure must not turn a working answer into an error,
 * so every path here swallows and warns. The row is telemetry; the answer is the
 * product.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { BeamOutcome, CapabilityId } from "./types";

const MAX_STORED_LENGTH = 300;

const REDACTIONS: ReadonlyArray<[RegExp, string]> = [
  // Email addresses.
  [/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[redacted email]"],
  // Phone-shaped digit runs, including separators. Deliberately eager: a real
  // fantasy question almost never contains ten consecutive digits.
  [/(\+?\d[\d\s().-]{8,}\d)/g, "[redacted number]"],
  // Anything that looks like a URL with credentials or a long token.
  [/https?:\/\/\S+/gi, "[redacted link]"],
];

/** Redact, collapse whitespace, and clamp. Safe to call on anything. */
export function scrubQuestion(input: string): string {
  let s = String(input ?? "");
  for (const [pattern, replacement] of REDACTIONS) s = s.replace(pattern, replacement);
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, MAX_STORED_LENGTH);
}

export type LogBeamQueryInput = {
  question: string;
  questionNormalized: string;
  outcome: BeamOutcome["kind"] | "error";
  capabilityId?: CapabilityId | null;
  failureReason?: string | null;
  confidence?: number | null;
  playerIds?: string[];
  formatSlug?: string | null;
  sourceSlug?: string | null;
  latencyMs?: number | null;
  actorHash?: string | null;
  userId?: string | null;
};

/**
 * Insert the row and return its id, so the "Help BEAM learn this" form can link
 * a submission back to the exact parse that failed. Returns null on any failure.
 */
export async function logBeamQuery(
  admin: SupabaseClient<Database>,
  input: LogBeamQueryInput,
): Promise<string | null> {
  try {
    const question = scrubQuestion(input.question);
    if (!question) return null;

    const { data, error } = await admin
      .from("beam_queries")
      .insert({
        question,
        question_normalized: scrubQuestion(input.questionNormalized),
        capability_id: input.capabilityId ?? null,
        outcome: input.outcome,
        failure_reason: input.failureReason ?? null,
        confidence:
          typeof input.confidence === "number" && Number.isFinite(input.confidence)
            ? Math.min(1, Math.max(0, input.confidence))
            : null,
        player_ids: input.playerIds && input.playerIds.length > 0 ? input.playerIds : null,
        format_slug: input.formatSlug ?? null,
        source_slug: input.sourceSlug ?? null,
        latency_ms: input.latencyMs ?? null,
        actor_hash: input.actorHash ?? null,
        user_id: input.userId ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.warn("[beam] query log insert failed", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.warn("[beam] query log write failed", err);
    return null;
  }
}

/**
 * Read one logged question back by id, used to verify that a learning request is
 * attached to a question we actually saw.
 *
 * This is why the submit route does not simply trust the question in the POST
 * body: a caller could otherwise file arbitrary text against someone else's
 * query id, and the admin queue would show a fabricated pairing.
 */
export async function readLoggedQuestion(
  admin: SupabaseClient<Database>,
  queryId: string,
  owner: { actorHash: string | null; userId: string | null },
): Promise<{ id: string; question: string } | null> {
  try {
    const { data } = await admin
      .from("beam_queries")
      .select("id, question, actor_hash, user_id")
      .eq("id", queryId)
      .maybeSingle();
    if (!data) return null;

    // The caller has to be the person who asked. A signed-in user matches on
    // user id; a guest matches on the salted actor hash. A row with neither
    // recorded belongs to nobody and is not adoptable.
    const matchesUser =
      owner.userId !== null && data.user_id !== null && data.user_id === owner.userId;
    const matchesActor =
      owner.actorHash !== null &&
      data.actor_hash !== null &&
      data.actor_hash === owner.actorHash;
    if (!matchesUser && !matchesActor) return null;

    return { id: data.id, question: data.question };
  } catch {
    return null;
  }
}
