import "server-only";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";

/**
 * The Team Blueprint rebuild meter (plan 8.4).
 *
 * Claimed ONLY when a rebuild is going to run: after the roster id is
 * validated, the league found and the stored blueprint judged stale. A fresh
 * cached view costs nothing. Per actor (the signed-in user id or a salted hash
 * of the client IP, resolved inside claimRateLimitSlot), and FAILS CLOSED: a
 * limiter outage refuses the rebuild and the page shows the stored view with
 * its "as of" line, or the "Try again in a minute" state when there is none.
 *
 * One bucket per page. The findTrades runs inside a build do not also claim
 * the trade-impact-suggest bucket; the Blueprint is its own page with its own
 * budget.
 */

export const BLUEPRINT_BUILD_BUCKET = "blueprint-build";
export const BLUEPRINT_BUILD_MAX = 12;
export const BLUEPRINT_BUILD_WINDOW_SECONDS = 60;

export async function claimBlueprintBuildSlot(): Promise<boolean> {
  return claimRateLimitSlot({
    bucket: BLUEPRINT_BUILD_BUCKET,
    max: BLUEPRINT_BUILD_MAX,
    windowSeconds: BLUEPRINT_BUILD_WINDOW_SECONDS,
  });
}
