import { createAdminClient } from "@/lib/supabase/server";
import { submitGuess } from "@/lib/signal-scout/round-engine";
import {
  requireFfBeaconHeader,
  privateJson,
  resolveRoundIdentity,
  identityKeyFor,
  claimAction,
  engineErrorStatus,
  uuidSchema,
} from "@/lib/signal-scout/route-helpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/games/signal-scout/round/[id]/guess
 *
 * Submits a guess against the caller's own active round (plan section 14).
 * Order of operations (mirrors round/route.ts and plan section 15):
 *   1. x-requested-with header guard.
 *   2. Round id path param validated as a uuid.
 *   3. Body { guessedPlayerId } validated as a uuid.
 *   4. Resolve identity (no cookie minting here; a guess implies an active
 *      round already exists for this identity, so the guest cookie was
 *      already set by the round-start call that created it).
 *   5. Rate claim (2s window) so a brute-force script cannot spam guesses
 *      faster than the 3-strike fail limit already allows for.
 *   6. Engine submitGuess: duplicate free (409), out-of-pool (400),
 *      ownership/active checks (404/409). A survivable wrong guess returns
 *      the active DTO; a completing guess (won, solved_late, or the failing
 *      third strike) returns the completed DTO with the full reveal. Both
 *      pass through untouched, since the engine already enforces the
 *      anti-cheat invariant on what each DTO may contain.
 *   7. try/catch -> 500, no DB detail leaked.
 */

const GUESS_WINDOW_SECONDS = 2;

const guessBodySchema = uuidSchema;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireFfBeaconHeader(req)) {
    return privateJson({ error: "forbidden" }, 403);
  }

  const { id } = await params;
  const roundIdResult = uuidSchema.safeParse(id);
  if (!roundIdResult.success) {
    return privateJson({ error: "not_found" }, 404);
  }
  const roundId = roundIdResult.data;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return privateJson({ error: "invalid_request" }, 400);
  }
  const bodyResult = guessBodySchema.safeParse(
    body && typeof body === "object" ? (body as { guessedPlayerId?: unknown }).guessedPlayerId : undefined,
  );
  if (!bodyResult.success) {
    return privateJson({ error: "invalid_request" }, 400);
  }
  const guessedPlayerId = bodyResult.data;

  try {
    const admin = createAdminClient();
    const { identity } = await resolveRoundIdentity(req);

    const claimed = await claimAction(admin, identityKeyFor(identity), "guess", GUESS_WINDOW_SECONDS);
    if (!claimed) {
      return privateJson({ error: "rate_limited" }, engineErrorStatus("rate_limited"));
    }

    const result = await submitGuess(admin, identity, roundId, guessedPlayerId);
    if (!result.ok) {
      return privateJson({ error: result.code }, engineErrorStatus(result.code));
    }

    return privateJson({ round: result.round }, 200);
  } catch (err) {
    console.error("[signal-scout] guess submit failed", err);
    return privateJson({ error: "server_error" }, 500);
  }
}
