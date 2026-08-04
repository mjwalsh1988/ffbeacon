import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";

/**
 * POST /api/leagues/[league_id]/sync
 *
 * Calculate a league from the league list, without leaving it.
 *
 * The list at /tools/league-pulse and /my-beacon/sleeper-leagues tags every
 * roster Competitor, Mid Tier, or Rebuilder, and shows where that team
 * is projected to finish. Both come from Power Pulse, which only exists for a
 * league somebody has opened. Until now the only way to fill in a "Not yet
 * synced" row was to open the league. This does the same work in place.
 *
 * PUBLIC, like /warm and /refresh beside it, and for the same reason: it can only
 * cause the work that opening the league would cause, and writes nothing a page
 * render would not write.
 *
 * WHAT MAKES IT SAFE TO EXPOSE
 *   A visitor holds exactly one sync slot. While a sync is in flight, that
 *   visitor's next request is refused; after it finishes, the next one waits out
 *   a short cooldown. The claim is atomic (a SECURITY DEFINER RPC behind a row
 *   lock), so two clicks landing together collapse to one sync rather than both
 *   reading "free". The browser greys the other buttons out, but that is a
 *   courtesy to the reader, not the control; this is the control.
 *
 *   The actor key is derived server-side from the session cookie, falling back
 *   to a salted hash of the trusted client IP. It is never read from the body:
 *   a caller who names their own limit key has no limit.
 *
 * The slot is released in a finally, so a sync that throws costs the visitor a
 * cooldown rather than locking them out until the lease expires.
 *
 * Response shape:
 *   200 { ok: true, cached: boolean }
 *   400 { error: "Invalid league id" }
 *   403 { error: "Invalid request" }                    (missing same-origin header)
 *   404 { error: "We could not find that league on Sleeper." }
 *   429 { error, retryInSeconds, reason: "in_flight" | "cooldown" }
 *   500 { error }
 */

/** Kept in step with COOLDOWN_SECONDS in lib/league-sync-queue.tsx and with the
 *  p_cooldown_seconds default on try_claim_league_sync. */
const COOLDOWN_SECONDS = 5;

/**
 * How long a claim may sit unreleased before another request may take it over.
 * Only reached when a process dies mid-sync; a normal run releases in a finally.
 */
const LEASE_SECONDS = 180;

/**
 * What we tell a caller who is blocked by their own in-flight sync. The RPC
 * reports the remaining lease, which is a crash guard and not a real wait, so
 * quoting it back would tell someone to wait three minutes for work that is
 * usually seconds from done.
 */
const IN_FLIGHT_RETRY_SECONDS = 5;

type ClaimResult = {
  claimed?: boolean;
  retry_after_seconds?: number;
  in_flight?: boolean;
};

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

  const admin = createAdminClient();

  const { data: claim, error: claimErr } = await admin.rpc(
    "try_claim_league_sync" as never,
    {
      p_actor_key: actorKey,
      p_sleeper_league_id: sleeperLeagueId,
      p_cooldown_seconds: COOLDOWN_SECONDS,
      p_lease_seconds: LEASE_SECONDS,
    } as never,
  );
  if (claimErr) {
    console.error("[league-sync] claim rpc failed", claimErr);
    return NextResponse.json(
      { error: "We could not start that sync. Try again shortly." },
      { status: 500 },
    );
  }

  const result = (claim ?? {}) as ClaimResult;
  if (result.claimed !== true) {
    const inFlight = result.in_flight === true;
    const retryInSeconds = inFlight
      ? IN_FLIGHT_RETRY_SECONDS
      : (result.retry_after_seconds ?? COOLDOWN_SECONDS);
    return NextResponse.json(
      {
        error: inFlight
          ? "One league syncs at a time. Wait for the current one to finish."
          : `Only one sync every ${COOLDOWN_SECONDS} seconds.`,
        retryInSeconds,
        reason: inFlight ? "in_flight" : "cooldown",
      },
      { status: 429 },
    );
  }

  try {
    // Exactly what the deep view does, in the same order. Core first, so a
    // league Sleeper does not know about fails before any derived work starts.
    const core = await pulseLeagueCore(admin, sleeperLeagueId);
    if (!core.ok) {
      return NextResponse.json(
        { error: "We could not find that league on Sleeper." },
        { status: 404 },
      );
    }

    // Awaited, unlike the warm-up endpoint, which backgrounds this half. The
    // caller is going to re-render the row the moment we answer, and the
    // standing it wants is produced here.
    await pulseLeagueDerived(admin, core.leagueRowId, {
      resynced: !core.cached,
    });

    return NextResponse.json({ ok: true, cached: core.cached });
  } catch (err) {
    console.error(
      `[league-sync] sync failed for ${sleeperLeagueId}:`,
      (err as Error).message,
    );
    // Deliberately not the underlying message: it can carry connection strings
    // and upstream detail that a public endpoint has no business echoing.
    return NextResponse.json(
      { error: "That sync did not finish. It usually works on a second try." },
      { status: 500 },
    );
  } finally {
    // Frees the slot and starts the cooldown, on every path including a throw.
    const { error: releaseErr } = await admin.rpc(
      "release_league_sync" as never,
      { p_actor_key: actorKey } as never,
    );
    if (releaseErr) {
      // The lease expiry covers this; the visitor waits it out rather than
      // being locked out for good.
      console.warn("[league-sync] release failed", releaseErr);
    }
  }
}
