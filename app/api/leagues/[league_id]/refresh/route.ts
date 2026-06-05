import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pulseLeague } from "@/lib/league-pulse";
import { getLeagueAdminContext } from "@/lib/league-auth";

const RATE_LIMIT_SECONDS = 60;

/**
 * POST /api/leagues/[league_id]/refresh
 *
 * Force-refresh a Sleeper league. Restricted to:
 *   1. FF Beacon users with user_preferences.is_admin=true, OR
 *   2. The Sleeper commissioner for the specific league (matched by
 *      sleeper username persisted in user_preferences)
 *
 * Rate limit: one successful refresh per league per RATE_LIMIT_SECONDS.
 * Backed by the league_refresh_attempts table so the limit holds across
 * Next.js instances. Hot reloads and multi-instance deploys can't bypass it.
 *
 * Response shape:
 *   200 OK { ok: true, cached: false, counts: { rosters, users, transactions } }
 *   401     { error: "Authentication required" }
 *   403     { error: "Not authorized to refresh this league" }
 *   404     { error: "League not found" }
 *   429     { error: "Rate limited", retryInSeconds: number }
 *   500     { error: <message> }
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ league_id: string }> },
) {
  const { league_id: sleeperLeagueId } = await params;
  if (!sleeperLeagueId || sleeperLeagueId.length > 64) {
    return NextResponse.json({ error: "Invalid league id" }, { status: 400 });
  }

  // Cheap CSRF defense: require a custom header. Same-origin fetches
  // always set this; cross-origin form posts cannot set custom headers
  // without a CORS preflight, which we never grant.
  const requestedWith = _req.headers.get("x-requested-with");
  if (requestedWith !== "ff-beacon") {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const supabase = await createClient();
  const adminClient = createAdminClient();

  // Look up league row id from the sleeper id.
  const { data: leagueRow, error: leagueErr } = await adminClient
    .from("leagues")
    .select("id")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (leagueErr) {
    console.error("[refresh] league lookup failed", leagueErr);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!leagueRow) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  // AUTH: re-validate independent of the client.
  const auth = await getLeagueAdminContext(supabase, leagueRow.id);
  if (!auth.userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!auth.canForceRefresh) {
    return NextResponse.json(
      { error: "Not authorized to refresh this league" },
      { status: 403 },
    );
  }

  // RATE LIMIT: atomic claim via the SECURITY DEFINER function. The
  // function returns true when the caller has won the rate-limit race
  // for this window, false otherwise. This avoids the TOCTOU window
  // between read-and-write that two concurrent admins could exploit.
  const { data: claimed, error: claimErr } = await adminClient.rpc(
    "try_claim_league_refresh" as never,
    {
      p_league_id: leagueRow.id,
      p_user_id: auth.userId,
      p_triggered_via: auth.isAdmin ? "admin" : "commissioner",
      p_window_seconds: RATE_LIMIT_SECONDS,
    } as never,
  );
  if (claimErr) {
    console.error("[refresh] rate-limit rpc failed", claimErr);
    return NextResponse.json({ error: "Rate-limit check failed" }, { status: 500 });
  }
  if (claimed !== true) {
    return NextResponse.json(
      {
        error: `Rate limited. Try again in up to ${RATE_LIMIT_SECONDS} seconds.`,
        retryInSeconds: RATE_LIMIT_SECONDS,
      },
      { status: 429 },
    );
  }

  // Force a pulse. This bypasses the 10-minute LEAGUE_PULSE_TTL_MS cache.
  const result = await pulseLeague(adminClient, sleeperLeagueId, { force: true });
  if (!result.ok) {
    console.error("[refresh] pulseLeague failed", result.error);
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    cached: result.cached,
    counts: result.counts,
  });
}
