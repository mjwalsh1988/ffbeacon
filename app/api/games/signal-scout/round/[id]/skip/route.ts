import { createAdminClient } from "@/lib/supabase/server";
import { skipRound } from "@/lib/signal-scout/round-engine";
import {
  requireFfBeaconHeader,
  privateJson,
  resolveRoundIdentity,
  engineErrorStatus,
  uuidSchema,
} from "@/lib/signal-scout/route-helpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/games/signal-scout/round/[id]/skip
 *
 * Completes an active round as skipped: reveals the target, resets the
 * Signal Streak, and counts toward the Daily Scout Streak (plan sections 5,
 * 6, 20). Order of operations:
 *   1. x-requested-with header guard.
 *   2. Validate the id is a uuid; a malformed id returns not_found the same
 *      as a missing round, so there is no oracle about id shape.
 *   3. Resolve identity from session or guest cookie. No cookie is minted or
 *      set on this route: a freshly minted guest id cannot own any existing
 *      round, so an unrecognized guest simply falls through to not_found.
 *   4. skipRound: ownership and active-status checks live in the engine;
 *      unknown/unowned rounds and an already-completed round both come back
 *      as typed errors (not_found, round_not_active).
 *
 * No rate claim here: plan section 15 lists claim windows on guest starts,
 * guesses, hints, and search only. Skip has no analogous abuse surface to
 * rate-limit; it is once-per-round by construction, since the engine's
 * status guard (round.status !== "active") makes a second skip attempt on
 * the same round return round_not_active rather than doing anything twice.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireFfBeaconHeader(req)) {
    return privateJson({ error: "forbidden" }, 403);
  }

  const { id } = await params;
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) {
    return privateJson({ error: "not_found" }, 404);
  }

  try {
    const { identity } = await resolveRoundIdentity(req);
    const admin = createAdminClient();
    const result = await skipRound(admin, identity, parsedId.data);
    if (!result.ok) {
      return privateJson({ error: result.code }, engineErrorStatus(result.code));
    }

    return privateJson({ round: result.round }, 200);
  } catch (err) {
    console.error("[signal-scout] skip round failed", err);
    return privateJson({ error: "server_error" }, 500);
  }
}
