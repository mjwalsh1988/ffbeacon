import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";

/**
 * Claim one slot in a durable per-actor rate limit, from anywhere on the server.
 *
 * This was written twice before it was written once: `claimSlot` inside
 * app/actions/trade-finder.ts, and then again the moment a SERVER RENDERED path
 * needed the same protection. Two copies of a limiter is how one of them ends up
 * with the wrong window, so there is one, and both callers pass their bucket in.
 *
 * WHY A SERVER COMPONENT NEEDS THIS AT ALL
 *   A server action is easy to think of as "the expensive entry point", and it
 *   is the one people guard. But a page that decodes work out of its own URL and
 *   does that work during render is an entry point too, and it is the cheaper
 *   one to attack: a loop over GET requests, no JavaScript, no action id, no
 *   session. Trade Ideas evaluates a trade encoded in `?in=` and `?out=`, so it
 *   claims a slot exactly like the action does.
 *
 * FAILS CLOSED
 *   A limit that cannot be evaluated is not a limit that passes. If the actor
 *   cannot be derived, the admin client cannot be built, or the RPC errors, this
 *   returns false and the caller degrades. The work behind these buckets is
 *   precisely what an unbounded caller would want to spend our database on.
 *
 * THE ACTOR IS DERIVED, NEVER SUBMITTED
 *   `resolveRateLimitActorKey` reads the session cookie and the platform's own
 *   forwarding headers (lib/client-ip.ts refuses the client-controlled leftmost
 *   x-forwarded-for entry for this reason). A caller who picks their own limit
 *   key has no limit. `headers()` is wrapped in a Request because that helper
 *   reads a Request and nothing else, which keeps one derivation of the trusted
 *   client IP in the codebase rather than a second that could drift.
 */
export async function claimRateLimitSlot(params: {
  /** Namespace for the ledger row. One bucket per kind of work. */
  bucket: string;
  /** Requests permitted per window, per actor. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}): Promise<boolean> {
  const { bucket, max, windowSeconds } = params;
  try {
    const requestHeaders = await headers();
    const actorKey = await resolveRateLimitActorKey(
      new Request(`https://ffbeacon.internal/${bucket}`, { headers: requestHeaders }),
    );
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("try_claim_rate_limit" as never, {
      p_bucket: bucket,
      p_key: actorKey,
      p_max_requests: max,
      p_window_seconds: windowSeconds,
    } as never);
    if (error) throw new Error(error.message);
    return Boolean(data);
  } catch (err) {
    console.error(`[rate-limit] claim failed for bucket ${bucket}`, err);
    return false;
  }
}
