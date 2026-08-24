import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import {
  LEAGUE_SYNC_COOLDOWN_SECONDS,
  syncLeagueOnDemand,
} from "@/lib/league-on-demand-sync";

/**
 * POST /api/leagues/[league_id]/sync
 *
 * Calculate a league from the league list, without leaving it.
 *
 * The list at /tools/league-pulse and /my-beacon/sleeper-leagues tags every
 * roster Contender, Bubble, Rebuilder, or Longshot, and shows where that team
 * is projected to finish. Both come from Power Pulse, which only exists for a
 * league somebody has opened. Until now the only way to fill in a "Not yet
 * synced" row was to open the league. This does the same work in place.
 *
 * PUBLIC, like /warm and /refresh beside it, and for the same reason: it can only
 * cause the work that opening the league would cause, and writes nothing a page
 * render would not write.
 *
 * The claim, the cooldown, and the sync itself live in
 * lib/league-on-demand-sync.ts, shared with the FAAB calculator and the Beacon
 * Breakdown, which sync a league the moment a reader picks an unsynced one. One
 * implementation and one per-visitor budget, so alternating between the three
 * surfaces cannot buy three of them.
 *
 * Response shape:
 *   200 { ok: true, cached: boolean }
 *   400 { error: "Invalid league id" }
 *   403 { error: "Invalid request" }                    (missing same-origin header)
 *   404 { error: "We could not find that league on Sleeper." }
 *   429 { error, retryInSeconds, reason: "in_flight" | "cooldown" }
 *   500 { error }
 */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ league_id: string }> },
) {
  const { league_id: sleeperLeagueId } = await params;
  if (!sleeperLeagueId || !/^[a-zA-Z0-9_-]{1,64}$/.test(sleeperLeagueId)) {
    return NextResponse.json({ error: "Invalid league id" }, { status: 400 });
  }

  // Same-origin defense, matching /refresh and /warm: a custom header that a
  // cross-origin form post cannot set without a CORS preflight we never grant.
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  // Refuses rather than guesses when it cannot attribute the caller (a missing
  // IP salt in production is the only realistic cause). Failing closed here is
  // the point: an unattributable caller with no key would otherwise get an
  // unlimited slot, which is worse than the feature being briefly unavailable.
  let actorKey: string;
  try {
    actorKey = await resolveRateLimitActorKey(req);
  } catch (err) {
    console.error("[league-sync] could not derive a limit key:", (err as Error).message);
    return NextResponse.json(
      { error: "Syncing is unavailable right now. Open the league instead." },
      { status: 503 },
    );
  }

  const outcome = await syncLeagueOnDemand(
    createAdminClient(),
    sleeperLeagueId,
    actorKey,
  );

  if (outcome.ok) {
    return NextResponse.json({ ok: true, cached: outcome.cached });
  }

  if (outcome.reason === "in_flight" || outcome.reason === "cooldown") {
    return NextResponse.json(
      {
        error: outcome.error,
        retryInSeconds: outcome.retryInSeconds || LEAGUE_SYNC_COOLDOWN_SECONDS,
        reason: outcome.reason,
      },
      { status: 429 },
    );
  }

  if (outcome.reason === "not_found") {
    return NextResponse.json({ error: outcome.error }, { status: 404 });
  }

  return NextResponse.json({ error: outcome.error }, { status: 500 });
}
