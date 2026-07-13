import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pulseLeague } from "@/lib/league-pulse";

const RATE_LIMIT_SECONDS = 60;

/**
 * POST /api/leagues/[league_id]/refresh
 *
 * PUBLIC by design. Any visitor (guest, signed-in non-commissioner, commissioner,
 * or FF Beacon admin) may request a refresh of a Sleeper league. There is no
 * commissioner, admin, or logged-in requirement.
 *
 * The only protection is a shared, atomic, per-league cooldown
 * (RATE_LIMIT_SECONDS): once anyone refreshes a league, nobody can refresh that
 * same league again until the window elapses. Different leagues have independent
 * cooldowns.
 *
 * Why no commissioner check (FFB-SEC-004 / FFB-SEC-007 reclassification): the old
 * gate matched a self-declared Sleeper username against the commissioner display
 * name, which proves nothing about Sleeper account ownership. Because refresh is
 * intentionally public, that unverified check was both untrustworthy and
 * unnecessary, so it was removed rather than replaced.
 *
 * The cooldown is claimed via the SECURITY DEFINER RPC through the service-role
 * client. EXECUTE on that RPC is service_role-only (migration 0134), so a guest
 * cannot occupy the slot by calling PostgREST directly, and cannot spoof the audit
 * identity: the optional actor id below is derived server-side from the session
 * cookie, never from the request body. No secret ever reaches the browser.
 *
 * Response shape:
 *   200 OK { ok: true, cached: false, counts: { rosters, users, transactions } }
 *   400     { error: "Invalid league id" }
 *   403     { error: "Invalid request" }        (missing same-origin header)
 *   404     { error: "League not found" }
 *   429     { error: "Rate limited", retryInSeconds: number }
 *   500     { error: <message> }
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ league_id: string }> },
) {
  const { league_id: sleeperLeagueId } = await params;
  if (!sleeperLeagueId || !/^[a-zA-Z0-9_-]{1,64}$/.test(sleeperLeagueId)) {
    return NextResponse.json({ error: "Invalid league id" }, { status: 400 });
  }

  // Same-origin defense: require a custom header. Same-origin fetches always set
  // this; cross-origin form posts cannot set custom headers without a CORS
  // preflight, which we never grant. This does not restrict guests on our own
  // site; it only blocks cross-site requests.
  if (_req.headers.get("x-requested-with") !== "ff-beacon") {
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

  // Optional actor for the audit ledger only. Derived server-side from the
  // session (trustworthy); guests resolve to null. Never used for authorization
  // and never read from the request body.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RATE LIMIT: atomic claim via the SECURITY DEFINER function, called through the
  // service-role client. Returns true when the caller wins the cooldown race for
  // this window, false otherwise. This closes the TOCTOU window between read and
  // write, so concurrent requests for the same league collapse to a single sync.
  const { data: claimed, error: claimErr } = await adminClient.rpc(
    "try_claim_league_refresh" as never,
    {
      p_league_id: leagueRow.id,
      p_user_id: user?.id ?? null,
      p_triggered_via: "public",
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

  // Force a pulse. This bypasses the 60-minute LEAGUE_PULSE_TTL_MS cache and
  // always recomputes power rankings (force skips the 24h power-rankings gate).
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
