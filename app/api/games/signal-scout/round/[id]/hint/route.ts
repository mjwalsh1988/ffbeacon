import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { purchaseHint } from "@/lib/signal-scout/round-engine";
import {
  requireFfBeaconHeader,
  privateJson,
  resolveRoundIdentity,
  identityKeyFor,
  claimAction,
  engineErrorStatus,
  uuidSchema,
  tierSchema,
  confirmBurnSchema,
} from "@/lib/signal-scout/route-helpers";

export const dynamic = "force-dynamic";

/**
 * Windowed abuse-guard interval for hint purchases (plan section 13: "10/min
 * per round"). The claim ledger is a min-interval guard rather than a
 * counter, so one claim every 6 seconds is the equivalent cap; since an
 * identity can only ever have one active round, per-identity is per-round.
 */
const HINT_WINDOW_SECONDS = 6;

const hintBodySchema = z.object({
  tier: tierSchema,
  confirmBurn: confirmBurnSchema.optional().default(false),
});

/**
 * POST /api/games/signal-scout/round/[id]/hint
 *
 * Reveals one clue of the requested tier and deducts its cost (plan section
 * 13). Order of operations:
 *   1. x-requested-with header guard.
 *   2. Round id must be a well-formed uuid, else not_found (no id-shape
 *      oracle: a malformed id and an id for someone else's round look
 *      identical to the caller).
 *   3. Parse and zod-validate the body; a malformed tier or unparsable JSON
 *      is rejected before any identity or DB work.
 *   4. Resolve identity (session, else guest cookie). Hint calls always come
 *      from an established identity, so unlike POST /round this route never
 *      mints or sets a guest cookie: a minted-id guest cannot own an
 *      existing round and simply gets not_found from the engine.
 *   5. Rate claim (HINT_WINDOW_SECONDS) for the identity.
 *   6. purchaseHint runs the full dead-signal purchase sequence (tier
 *      disabled, limit reached, tier exhausted, burn confirmation) and
 *      returns the minimal success payload or a typed error code.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireFfBeaconHeader(req)) {
    return privateJson({ error: "forbidden" }, 403);
  }

  const { id } = await params;
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) {
    return privateJson({ error: "not_found" }, 404);
  }
  const roundId = idResult.data;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return privateJson({ error: "invalid_request" }, 400);
  }

  const bodyResult = hintBodySchema.safeParse(rawBody);
  if (!bodyResult.success) {
    return privateJson({ error: "invalid_request" }, 400);
  }
  const { tier, confirmBurn } = bodyResult.data;

  try {
    const { identity } = await resolveRoundIdentity(req);
    const admin = createAdminClient();

    const claimed = await claimAction(admin, identityKeyFor(identity), "hint", HINT_WINDOW_SECONDS);
    if (!claimed) {
      return privateJson({ error: "rate_limited" }, engineErrorStatus("rate_limited"));
    }

    const result = await purchaseHint(admin, identity, roundId, tier, confirmBurn);
    if (!result.ok) {
      return privateJson({ error: result.code }, engineErrorStatus(result.code));
    }

    return privateJson(
      {
        clue: result.clue,
        scoreAvailable: result.scoreAvailable,
        burned: result.burned,
        hintsUsed: result.hintsUsed,
        tierPurchasesRemaining: result.tierPurchasesRemaining,
        lockedCounts: result.lockedCounts,
      },
      200,
    );
  } catch (err) {
    console.error("[signal-scout] hint purchase failed", err);
    return privateJson({ error: "server_error" }, 500);
  }
}
