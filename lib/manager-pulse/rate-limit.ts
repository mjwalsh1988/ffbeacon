import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";
import type { ManagerPulseSettings } from "./default-settings";

/**
 * The rate limit on resolving a Sleeper handle: docs/manager-pulse-plan.md
 * section 9, "Rate limits: ... plus claimRateLimitSlot on the handle lookup
 * endpoint so an authenticated user cannot enumerate handles at speed."
 *
 * TWO WINDOWS, ONE ACTOR. `handleLookupPerMinute` stops a script hammering
 * the lookup in a burst; `handleLookupPerDay` stops a slower crawl that
 * stays under the per-minute ceiling but still enumerates handles all day.
 * Both buckets are claimed, and either one refusing fails the whole call.
 *
 * FAILS CLOSED, ON PURPOSE, AND IN THE OPPOSITE DIRECTION FROM A CACHED
 * READ. `claimRateLimitSlot` already fails closed on any error (a broken
 * session read, a missing admin client, an RPC error all return false), and
 * this wrapper adds nothing that could turn that into an open pass: a
 * limiter outage here means nobody can resolve a new handle for a moment,
 * which is the right direction, because this endpoint can enumerate real
 * people. Contrast rendering an already-CACHED report, which fails OPEN by
 * design elsewhere in this feature: a limiter outage must not turn every
 * stored report into an error state, because a stale report costs nothing
 * extra to serve and an unmetered lookup does.
 *
 * `admin` and `userId` are part of this signature for call-site symmetry
 * with the rest of Manager Pulse's service functions, which all take an
 * explicit admin client and a resolved user id rather than deriving their
 * own. The claim itself goes through `claimRateLimitSlot`, which derives its
 * own actor key from the session cookie (or the trusted client IP for a
 * guest) and builds its own service-role client; the signed-in user making
 * this call is the same person that key resolves to, so there is nothing to
 * reconcile between the two.
 *
 * `retryAfterSeconds` on a refusal is the window length of whichever bucket
 * refused, not a precise remaining count: the underlying durable rate limit
 * (lib/rate-limit-claim.ts, try_claim_rate_limit) reports only a pass/fail
 * per claim, not time remaining in the current window, so the window length
 * is the honest upper bound rather than an invented precise number.
 */
export async function claimManagerLookupSlot(params: {
  admin: SupabaseClient<Database>;
  userId: string;
  settings: ManagerPulseSettings;
}): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const { settings } = params;

  const MINUTE_WINDOW_SECONDS = 60;
  const DAY_WINDOW_SECONDS = 86400;

  // THE DAY BUCKET IS CLAIMED FIRST, AND THAT ORDER IS THE POINT.
  //
  // The claims are not reversible: `claimRateLimitSlot` spends a slot and has
  // no release. Claiming the minute bucket first meant a reader already at
  // their DAILY ceiling burned a minute slot on every refused attempt, so a
  // refusal cost them capacity they could not have used anyway, and a client
  // retrying politely would keep the minute bucket permanently full for the
  // rest of the day.
  //
  // Taking the wider, slower-moving bucket first inverts that: once the day is
  // spent, nothing else is. The reverse waste (a day slot spent on a request
  // the minute bucket then refuses) is bounded by the minute limit itself, and
  // a burst is exactly the case the day ceiling is meant to catch anyway.
  const perDayOk = await claimRateLimitSlot({
    bucket: "manager-pulse-lookup-day",
    max: settings.lookup.handleLookupPerDay,
    windowSeconds: DAY_WINDOW_SECONDS,
  });
  if (!perDayOk) {
    return { ok: false, retryAfterSeconds: DAY_WINDOW_SECONDS };
  }

  const perMinuteOk = await claimRateLimitSlot({
    bucket: "manager-pulse-lookup-minute",
    max: settings.lookup.handleLookupPerMinute,
    windowSeconds: MINUTE_WINDOW_SECONDS,
  });
  if (!perMinuteOk) {
    return { ok: false, retryAfterSeconds: MINUTE_WINDOW_SECONDS };
  }

  return { ok: true };
}
