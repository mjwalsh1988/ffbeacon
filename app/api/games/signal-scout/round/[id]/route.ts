import { createAdminClient } from "@/lib/supabase/server";
import { getRound } from "@/lib/signal-scout/round-engine";
import {
  requireFfBeaconHeader,
  privateJson,
  resolveRoundIdentity,
  engineErrorStatus,
  uuidSchema,
} from "@/lib/signal-scout/route-helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/games/signal-scout/round/[id]
 *
 * Fetches a round the caller owns, active or completed. Order of operations
 * (plan section 20):
 *   1. x-requested-with header guard, applied here too even though the plan
 *      only mandates it on mutations, so every signal-scout route enforces
 *      the same guard uniformly.
 *   2. Validate the id is a uuid; a malformed id returns not_found the same
 *      as a missing round, so there is no oracle about id shape.
 *   3. Resolve identity from session or guest cookie. No cookie is minted or
 *      set on this route: a freshly minted guest id cannot own any existing
 *      round, so an unrecognized guest simply falls through to not_found.
 *   4. getRound decides active vs completed DTO shape; ownership mismatches
 *      and unknown ids both come back as not_found from the engine.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const result = await getRound(admin, identity, parsedId.data);
    if (!result.ok) {
      return privateJson({ error: result.code }, engineErrorStatus(result.code));
    }

    return privateJson({ round: result.round }, 200);
  } catch (err) {
    console.error("[signal-scout] get round failed", err);
    return privateJson({ error: "server_error" }, 500);
  }
}
