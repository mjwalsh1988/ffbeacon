/**
 * The guarded entry point for league mode on the Beacon Breakdown page.
 *
 * League mode is genuinely expensive: a projection pass over every roster in the
 * league plus three season simulations. It is also driven by a URL parameter, so
 * it can be triggered by anyone who can construct a link. That combination needs
 * three guards, and the order they fail in matters.
 *
 *   1. Cache. The same (league, roster, player, player) question inside a short
 *      window returns the stored answer. Rosters do not change minute to minute,
 *      and a reader flipping between lenses must not pay for the work again.
 *   2. Rate limit. Counted per actor (auth user, else salted IP hash) using the
 *      same ledger as every other public endpoint here.
 *   3. Graceful degradation. A limited or failed run does NOT error the page. It
 *      returns a notice and the reader gets the ordinary comparison, because a
 *      broken league lookup should never cost them the thing they came for.
 *
 * Nothing here writes. See lib/breakdown/league-impact.ts for why that matters.
 */

import "server-only";
import { headers } from "next/headers";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import {
  calculateLeagueImpact,
  type LeagueImpactReport,
} from "./league-impact";

const RATE_BUCKET = "breakdown_league";
const RATE_WINDOW_SECONDS = 60;

/**
 * Deliberately generous, because the limit is checked before the cache and
 * therefore counts cache HITS as well as real computations.
 *
 * The reason it has to sit there is that resolving the actor calls `headers()`,
 * a dynamic API that cannot run inside `unstable_cache`. So the honest tradeoff
 * is: either the limit is tight and a reader who flips between the three lenses
 * twice gets throttled for work we never actually did, or it is loose and a few
 * cache hits pass through freely. The real cost is bounded by DISTINCT (league,
 * roster, player, player) tuples, and each of those computes at most once per
 * five minutes, so twenty requests a minute is nowhere near twenty computations
 * a minute unless someone is deliberately walking the input space.
 */
const RATE_MAX = 20;

/**
 * How long one computed answer is reused.
 *
 * Five minutes is long enough that flipping lenses, opening a tab, or sharing a
 * link with a leaguemate all land on the cached answer, and short enough that a
 * waiver claim processed this morning shows up in the numbers this afternoon.
 */
const CACHE_TTL_SECONDS = 300;

export const SLEEPER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const SLEEPER_PLAYER_ID_PATTERN = /^[A-Za-z0-9]{1,32}$/;

export type LeagueModeResult = {
  report: LeagueImpactReport | null;
  /** Rendered as a status banner when league mode could not be delivered. */
  notice: string | null;
};

/** Fails closed: a limit we cannot evaluate is not a limit that passes. */
async function claimSlot(): Promise<boolean> {
  try {
    const requestHeaders = await headers();
    const actorKey = await resolveRateLimitActorKey(
      new Request("https://ffbeacon.internal/breakdown", { headers: requestHeaders }),
    );
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("try_claim_rate_limit" as never, {
      p_bucket: RATE_BUCKET,
      p_key: actorKey,
      p_max_requests: RATE_MAX,
      p_window_seconds: RATE_WINDOW_SECONDS,
    } as never);
    if (error) throw new Error(error.message);
    return Boolean(data);
  } catch (err) {
    console.error("[breakdown] league rate-limit check failed", err);
    return false;
  }
}

/**
 * The cached computation. Keyed on everything that can change the answer, so two
 * different questions never share an entry.
 */
const cachedImpact = (key: string) =>
  unstable_cache(
    async (
      leagueRowId: string,
      sleeperRosterId: number,
      sleeperA: string | null,
      sleeperB: string | null,
    ) => {
      const admin = createAdminClient();
      return calculateLeagueImpact(admin, {
        leagueRowId,
        sleeperRosterId,
        candidateSleeperIds: [sleeperA, sleeperB],
      });
    },
    ["breakdown-league-impact", key],
    { revalidate: CACHE_TTL_SECONDS, tags: ["breakdown-league-impact"] },
  );

export type LeagueModeRequest = {
  /** Sleeper league id from the URL. */
  sleeperLeagueId: string;
  /** Sleeper roster id from the URL. */
  rosterId: number;
  sleeperA: string | null;
  sleeperB: string | null;
};

/**
 * Resolve league mode for one page render. Never throws, never blocks the rest
 * of the page: every failure path returns a notice and a null report.
 */
export async function loadLeagueMode(
  request: LeagueModeRequest,
): Promise<LeagueModeResult> {
  if (!SLEEPER_ID_PATTERN.test(request.sleeperLeagueId)) {
    return { report: null, notice: "That league link does not look right." };
  }
  if (!Number.isInteger(request.rosterId) || request.rosterId <= 0) {
    return { report: null, notice: "That team link does not look right." };
  }
  const sleeperA =
    request.sleeperA && SLEEPER_PLAYER_ID_PATTERN.test(request.sleeperA)
      ? request.sleeperA
      : null;
  const sleeperB =
    request.sleeperB && SLEEPER_PLAYER_ID_PATTERN.test(request.sleeperB)
      ? request.sleeperB
      : null;
  if (!sleeperA && !sleeperB) {
    return {
      report: null,
      notice: "Neither of these players maps to a Sleeper id, so we cannot place them on a roster.",
    };
  }

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("id")
    .eq("sleeper_league_id", request.sleeperLeagueId)
    .maybeSingle();

  if (!league) {
    return {
      report: null,
      notice:
        "That league did not finish syncing. Pick it again from the league list and it will fill in.",
    };
  }

  if (!(await claimSlot())) {
    return {
      report: null,
      notice:
        "Comparing against a live roster is heavy work and you have run a few in the last minute. The general comparison is below; try the league view again shortly.",
    };
  }

  try {
    const key = `${league.id}:${request.rosterId}:${sleeperA ?? "-"}:${sleeperB ?? "-"}`;
    const outcome = await cachedImpact(key)(league.id, request.rosterId, sleeperA, sleeperB);
    if (!outcome.ok) return { report: null, notice: outcome.error };
    return { report: outcome.report, notice: null };
  } catch (err) {
    console.error("[breakdown] league impact failed", err);
    return {
      report: null,
      notice: "Something went wrong reading that league. The general comparison is below.",
    };
  }
}
