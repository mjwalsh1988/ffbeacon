import "server-only";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";

/**
 * The limit on the free agent panel, which is the expensive half of the
 * Lineups page.
 *
 * WHY THIS PAGE NEEDS ONE WHEN ITS SIBLINGS DO NOT
 *   Schedules, Power Pulse and Positional WAR are all cheap per render by
 *   construction: they read numbers a cached model already computed. Lineups is
 *   not. It projects a roster for a week and then, for the free agent panel,
 *   runs one optimal-lineup fill per candidate on top of the baseline (see
 *   WAIVER_CANDIDATE_POOL in ./data.ts). That is the only unbounded-ish work on
 *   the page, it sits behind an unauthenticated GET, and `?roster=` and `?week=`
 *   together give a script a large space of distinct fully-computing URLs to
 *   walk. The precedent is lib/trade-impact/rate-limit.ts, which meters a
 *   SERVER RENDERED path for exactly this reason: a page that decodes work out
 *   of its own URL and does that work during render is an entry point too, and
 *   the cheaper one to attack.
 *
 * WHY ONLY THE FREE AGENT PANEL, AND NOT THE WHOLE PAGE
 *   claimRateLimitSlot FAILS CLOSED (lib/rate-limit-claim.ts), which is the
 *   right direction for a bucket guarding a simulation and the wrong direction
 *   for a whole page: a limiter outage would turn every league's lineup into an
 *   error state, and the lineup is the thing a reader came for. Metering the
 *   panel instead bounds the work that actually amplifies, and a refusal
 *   degrades to one panel saying so while the lineup, the optimiser and the cut
 *   list all still render. Trade Ideas draws the same line: the page renders,
 *   the evaluation is what gets refused.
 *
 * CLAIMED AFTER VALIDATION, per the standing rule. The week is clamped to the
 * league's own slate and the roster is re-derived from this league's rows
 * before anything here is called, so a stale link or a forged parameter costs a
 * reader nothing from their budget and buys an attacker nothing either. It is
 * also claimed only when the panel is going to do the work at all: a past week
 * and a league whose format no source covers both skip it, so browsing history
 * never spends a slot.
 *
 * TWENTY PER MINUTE. A reader flipping through teams and weeks makes one
 * request per view; twenty is more than a person will do in a minute and is
 * reached instantly by a script, which is the shape of limit that costs real
 * readers nothing.
 */
export const LINEUP_WAIVER_BUCKET = "league-lineups-waivers";
export const LINEUP_WAIVER_WINDOW_SECONDS = 60;
export const LINEUP_WAIVER_MAX = 20;

/** Claim one slot for the free agent panel. Claim after validation, before the fills. */
export async function claimLineupWaiverSlot(): Promise<boolean> {
  return claimRateLimitSlot({
    bucket: LINEUP_WAIVER_BUCKET,
    max: LINEUP_WAIVER_MAX,
    windowSeconds: LINEUP_WAIVER_WINDOW_SECONDS,
  });
}
