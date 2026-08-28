import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { loadWouldYouRatherSettings } from "@/lib/would-you-rather/settings";
import {
  buildReview,
  loadRound,
  minimalReview,
  reloadPool,
} from "@/lib/would-you-rather/round";
import { castVote } from "@/lib/would-you-rather/vote";
import {
  guestVotesRemaining,
  guestVotesUsed,
  resolveActorKey,
  resolveVoter,
  WYR_GUEST_COOKIE,
  WYR_GUEST_COOKIE_OPTIONS,
} from "@/lib/would-you-rather/identity";
import {
  claimVoteSlot,
  errorStatus,
  privateJson,
  requireFfBeaconHeader,
} from "@/lib/would-you-rather/route-helpers";
import type { WyrErrorCode } from "@/lib/would-you-rather/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  tradeId: z.string().uuid(),
  side: z.enum(["a", "b"]),
});

/**
 * POST /api/games/would-you-rather/vote
 *
 * Record one vote and hand back the reveal.
 *
 * THE REVEAL IS BUILT HERE AND NOWHERE EARLIER. The verdict, the values, the
 * crowd split and the league context all live in this response, which is
 * produced only after a vote row exists. The page that renders the board never
 * receives any of it, so there is nothing in the HTML or the flight payload for
 * a reader to look up before they commit to an answer.
 *
 * ORDER OF OPERATIONS
 *   1. Same-origin header guard, then parse the body. Garbage costs nothing.
 *   2. Resolve the voter server-side. Identity is never read from the body.
 *   3. Feature gates, then the guest allowance.
 *   4. Rate limit, claimed AFTER validation so a malformed flood buys nothing.
 *   5. Write the vote. A repeat is not an error: the database's unique index
 *      decides, and a second attempt returns the reveal for the side they
 *      originally picked.
 *   6. Re-read the tallies and build the review.
 *
 * The guest allowance is checked BEFORE the write. A guest at their limit gets
 * the sign-in state, and no vote of theirs lands, so the count they are shown
 * and the count that exists never disagree.
 */
export async function POST(req: Request) {
  if (!requireFfBeaconHeader(req)) return privateJson({ ok: false, error: "bad_request" }, 400);

  const { voter, mintedGuestId } = await resolveVoter(req);

  const respond = (body: unknown, status: number) => {
    const res = privateJson(body, status);
    if (mintedGuestId) res.cookies.set(WYR_GUEST_COOKIE, mintedGuestId, WYR_GUEST_COOKIE_OPTIONS);
    return res;
  };
  const fail = (error: WyrErrorCode, remaining: number | null = null) =>
    respond({ ok: false, error, guestVotesRemaining: remaining }, errorStatus(error));

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return fail("bad_request");
  }

  try {
    const admin = createAdminClient();
    const settings = await loadWouldYouRatherSettings(admin);

    if (!settings.game_enabled) return fail("game_disabled");
    if (voter.kind === "guest" && !settings.guest_play_enabled) {
      return fail("guest_play_disabled");
    }

    const actorKey = await resolveActorKey(req);
    const used = await guestVotesUsed(admin, voter, actorKey);
    const remainingBefore =
      voter.kind === "guest" ? guestVotesRemaining(settings.guest_vote_limit, used) : null;
    if (voter.kind === "guest" && remainingBefore === 0) {
      return fail("guest_limit_reached", 0);
    }

    if (!(await claimVoteSlot())) return fail("rate_limited", remainingBefore);

    const loaded = await loadRound(admin, parsed.tradeId);
    if (!loaded) return fail("not_found", remainingBefore);

    const cast = await castVote(admin, {
      tradeId: parsed.tradeId,
      voter,
      side: parsed.side,
      actorKey,
    });
    if (!cast.ok) return fail(cast.error, remainingBefore);

    // THE VOTE IS NOW ON RECORD, so nothing past this point may report a
    // failure. A caller told "nothing was recorded" would press retry, land on
    // a different trade, and never see the reveal for a vote that was counted.
    // A reveal missing its verdict is a smaller loss than a lie about what
    // happened, so a failure here degrades to the tally alone.
    let review;
    try {
      // Tallies are re-read rather than adjusted in memory, so the bar a reader
      // sees includes their own vote AND everything that landed while they were
      // deciding.
      const pool = (await reloadPool(admin, parsed.tradeId)) ?? loaded.pool;
      review = await buildReview(admin, loaded, {
        yourSide: cast.side,
        alreadyVoted: cast.alreadyVoted,
        settings,
        pool,
      });
    } catch (err) {
      console.error("[would-you-rather] reveal failed after a recorded vote", err);
      review = minimalReview(loaded, loaded.pool, cast.side, cast.alreadyVoted);
    }

    const remainingAfter =
      voter.kind === "guest"
        ? guestVotesRemaining(
            settings.guest_vote_limit,
            cast.alreadyVoted ? used : used + 1,
          )
        : null;

    return respond({ ok: true, review, guestVotesRemaining: remainingAfter }, 200);
  } catch (err) {
    console.error("[would-you-rather] vote failed", err);
    return fail("server_error");
  }
}
