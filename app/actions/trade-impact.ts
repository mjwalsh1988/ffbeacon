"use server";

import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  claimTradeEntrySlot,
  claimTradeEvaluationSlot,
} from "@/lib/trade-impact/rate-limit";
import { evaluateValidatedTrade, validateProposal } from "@/lib/trade-impact/evaluate";
import { MAX_BUILD_ASSETS_PER_SIDE } from "@/lib/trade-impact/proposal-url";
import type { EvaluateTradeResponse } from "@/lib/trade-impact/types";

/**
 * Evaluate a proposed trade, from the builder.
 *
 * THE ORDER OF THE THREE GATES IS THE POINT
 *
 *   1. Shape. A zod parse, no database. Rejects a malformed payload for nothing.
 *   1b. The cheap outer meter, claimed before any read at all. Loose (60 a
 *      minute), so no real reader meets it.
 *   2. Ownership. ONE league read, no projection and no simulation. Rejects a
 *      trade whose players are not on the rosters it claims.
 *   3. The evaluation meter. Only now, because a reader must not lose a slot to
 *      a stale link they clicked. Then the expensive read and the simulation.
 *
 *   Reversing 2 and 3 would be the obvious build and the wrong one: it charges
 *   the honest reader for the dishonest caller's traffic. Leaving out 1b was the
 *   first build, and it meant the dishonest caller was charged nothing at all,
 *   because failing gate 2 skipped gate 3 entirely.
 *
 * THE SAME THREE GATES RUN ON THE SERVER RENDERED PATH.
 *   `/leagues/[id]/trade-ideas?mode=build&in=...&out=...` decodes a trade out of
 *   its own URL and evaluates it during render, which is an entry point with no
 *   action id, no JavaScript and no session behind it. Both paths claim from the
 *   one bucket in lib/trade-impact/rate-limit.ts, so alternating between them
 *   cannot buy a second budget.
 *
 * PUBLIC, like the league deep view it sits on. There is no auth gate here on
 * purpose: every figure it returns is derived from league data any visitor can
 * already see on the Overview and Power Pulse tabs. What it is protected by is
 * the per-actor limit and the ownership check.
 */

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const assetSchema = z.union([
  z.object({
    kind: z.literal("player"),
    playerId: z.string().regex(UUID_PATTERN),
  }),
  z.object({
    kind: z.literal("pick"),
    season: z.number().int().min(2000).max(2100),
    round: z.number().int().min(1).max(10),
    pickPosition: z.enum(["early", "mid", "late", "unknown"]),
  }),
]);

/**
 * Sleeper league ids are numeric strings. Bounded and pattern-matched because
 * this value reaches a PostgREST filter, and an id carrying a comma or a
 * parenthesis rewrites the filter rather than being matched by it.
 */
const inputSchema = z.object({
  sleeperLeagueId: z.string().regex(/^[0-9]{1,32}$/),
  myRosterId: z.number().int().min(0).max(1000),
  theirRosterId: z.number().int().min(0).max(1000),
  incoming: z.array(assetSchema).max(MAX_BUILD_ASSETS_PER_SIDE),
  outgoing: z.array(assetSchema).max(MAX_BUILD_ASSETS_PER_SIDE),
  username: z.string().trim().min(1).max(64).nullable().optional(),
  source: z.string().trim().max(64).nullable().optional(),
});

export async function evaluateProposedTrade(raw: unknown): Promise<EvaluateTradeResponse> {
  // Gate 1: shape. Costs nothing.
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "That trade could not be read. Rebuild it and try again." };
  }
  const input = parsed.data;

  if (input.myRosterId === input.theirRosterId) {
    return { ok: false, error: "A trade needs two different teams." };
  }
  if (input.incoming.length === 0 && input.outgoing.length === 0) {
    return { ok: false, error: "Add at least one player or pick to evaluate a trade." };
  }

  try {
    // Gate 1b: the cheap outer meter, claimed BEFORE any read.
    //
    // Without it, a syntactically valid proposal naming a player who is not on
    // the roster fails gate 2 and therefore never reaches gate 3, so it costs an
    // attacker nothing and costs us a league read every time. Garbage was the
    // one input that skipped the meter. This one is loose enough that no real
    // reader reaches it and tight enough that a loop does.
    const entryAllowed = await claimTradeEntrySlot();
    if (!entryAllowed) {
      return {
        ok: false,
        error: "That is a lot of requests in one minute. Give it a moment.",
        retryable: true,
      };
    }

    const supabase = await createClient();
    const admin = createAdminClient();
    const resolvedSource = await resolveSourceSlug(supabase, input.source ?? undefined);

    // Gate 2: ownership, against what the database says. One league read.
    const validated = await validateProposal(supabase, admin, {
      sleeperLeagueId: input.sleeperLeagueId,
      sourceSlug: resolvedSource.slug,
      identity: { username: input.username ?? null, rosterId: input.myRosterId },
      proposal: {
        myRosterId: input.myRosterId,
        theirRosterId: input.theirRosterId,
        incoming: input.incoming,
        outgoing: input.outgoing,
      },
    });
    if (!validated.ok) return { ok: false, error: validated.error };

    // Gate 3: the limit, claimed only now that we know the request is real.
    const allowed = await claimTradeEvaluationSlot();
    if (!allowed) {
      return {
        ok: false,
        error:
          "You have run a lot of evaluations in the last minute. Give it a moment and try again.",
        retryable: true,
      };
    }

    const result = await evaluateValidatedTrade(supabase, admin, validated.validated);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, impact: result.impact };
  } catch (err) {
    console.error("[trade-impact] evaluation failed", err);
    return {
      ok: false,
      error: "Something went wrong evaluating that trade. Please try again.",
    };
  }
}
