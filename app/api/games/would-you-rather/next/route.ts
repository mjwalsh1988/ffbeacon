import { createAdminClient } from "@/lib/supabase/server";
import { loadWouldYouRatherSettings } from "@/lib/would-you-rather/settings";
import {
  loadRound,
  loadVotedTradeIds,
  markServed,
  selectTradeId,
} from "@/lib/would-you-rather/round";
import { countActivePool, growPool, POOL_LOW_WATER_MARK } from "@/lib/would-you-rather/pool";
import {
  guestVotesRemaining,
  guestVotesUsed,
  resolveActorKey,
  resolveVoter,
  WYR_GUEST_COOKIE,
  WYR_GUEST_COOKIE_OPTIONS,
} from "@/lib/would-you-rather/identity";
import {
  claimNextSlot,
  errorStatus,
  privateJson,
  requireFfBeaconHeader,
} from "@/lib/would-you-rather/route-helpers";
import type { WyrErrorCode } from "@/lib/would-you-rather/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/games/would-you-rather/next
 *
 * The next trade to vote on, with no answer attached to it.
 *
 * ORDER OF OPERATIONS
 *   1. Same-origin header guard.
 *   2. Resolve the voter (session, else the guest cookie, else mint one).
 *   3. Feature gates: the game, and guest play for a signed-out caller.
 *   4. THE FREE-TRIAL WALL, BEFORE ANY WORK. A guest who has used their votes
 *      gets the sign-in state and nothing else. Grading a trade for somebody
 *      who cannot vote on it spends real query budget on a screen they will
 *      never see.
 *   5. Rate limit.
 *   6. Pick a trade they have not already called, load it, grade it.
 *
 * A round that fails to build is retried a couple of times with a different
 * trade rather than reported as an outage: a single unbuildable pool row
 * (its league resynced, a value source went dark) should cost the reader
 * nothing.
 */

/** How many different pool rows one request will try before giving up. */
const BUILD_ATTEMPTS = 3;

export async function GET(req: Request) {
  if (!requireFfBeaconHeader(req)) return privateJson({ ok: false, error: "bad_request" }, 400);

  const { voter, mintedGuestId } = await resolveVoter(req);

  const respond = (body: unknown, status: number) => {
    const res = privateJson(body, status);
    if (mintedGuestId) res.cookies.set(WYR_GUEST_COOKIE, mintedGuestId, WYR_GUEST_COOKIE_OPTIONS);
    return res;
  };
  const fail = (error: WyrErrorCode, remaining: number | null = null) =>
    respond({ ok: false, error, guestVotesRemaining: remaining }, errorStatus(error));

  try {
    const admin = createAdminClient();
    const settings = await loadWouldYouRatherSettings(admin);

    if (!settings.game_enabled) return fail("game_disabled");
    if (voter.kind === "guest" && !settings.guest_play_enabled) {
      return fail("guest_play_disabled");
    }

    // The actor is derived from the session and the platform's own headers, so
    // the allowance survives a discarded cookie. See identity.ts.
    const actorKey = await resolveActorKey(req);
    const used = await guestVotesUsed(admin, voter, actorKey);
    const remaining =
      voter.kind === "guest" ? guestVotesRemaining(settings.guest_vote_limit, used) : null;
    if (voter.kind === "guest" && remaining === 0) {
      return fail("guest_limit_reached", 0);
    }

    if (!(await claimNextSlot())) return fail("rate_limited", remaining);

    // A pool that has run thin is topped up inline, once, before the pick. One
    // pass is bounded work (a single sample window and a single league's
    // grading) and it keeps the game playable on a fresh install without a
    // separate job having to have run first.
    if ((await countActivePool(admin)) < POOL_LOW_WATER_MARK) {
      await growPool(admin, settings, { respectCooldown: true });
    }

    const voted = await loadVotedTradeIds(admin, {
      userId: voter.kind === "user" ? voter.userId : null,
      guestId: voter.kind === "guest" ? voter.guestId : null,
    });

    for (let attempt = 0; attempt < BUILD_ATTEMPTS; attempt += 1) {
      const tradeId = await selectTradeId(admin, voted);
      if (!tradeId) return fail("pool_empty", remaining);

      const loaded = await loadRound(admin, tradeId);
      if (!loaded) {
        // Do not offer this one again inside this request.
        voted.add(tradeId);
        continue;
      }

      await markServed(admin, loaded.pool);
      return respond({ ok: true, round: loaded.round, guestVotesRemaining: remaining }, 200);
    }

    return fail("pool_empty", remaining);
  } catch (err) {
    console.error("[would-you-rather] next round failed", err);
    return fail("server_error");
  }
}
