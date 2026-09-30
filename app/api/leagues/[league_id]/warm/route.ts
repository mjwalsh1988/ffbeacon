import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { LEAGUE_PULSE_TTL_MS, pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";
import { warmBudgetFor } from "@/lib/league-endpoint-limits";

/**
 * POST /api/leagues/[league_id]/warm
 *
 * Start a league's sync before the user opens it.
 *
 * The deep view's cold path is the slow one: a league nobody has looked at
 * recently has to be fetched from Sleeper before its page can say anything.
 * The league list already knows which leagues those are, so it calls this on
 * hover or keyboard focus and the work is underway (often finished) by the time
 * the click lands.
 *
 * This is deliberately the same work the page does, not a special case:
 *   - pulseLeagueCore respects the 60-minute cache, so a warm league costs one
 *     indexed read and returns.
 *   - Both halves coalesce per league, so a hover that lands while a real page
 *     render is already syncing joins that sync instead of starting a second.
 *
 * PUBLIC, like the page it warms: it can only cause the same fetch that opening
 * the league would, and it writes nothing a page load would not write. The
 * cache bounds how often one LEAGUE can reach Sleeper, but not how many leagues
 * one CALLER can send there, so a request that could reach Sleeper claims a
 * per-caller slot first (lib/league-endpoint-limits.ts): a generous budget for
 * a stored league gone stale, a tighter one for a league id we have never
 * stored, and nothing at all for a fresh stored league, which costs one read.
 * Everything is validated before a slot is claimed, so a malformed request
 * spends nobody's budget. Over budget is a quiet 429; the hook ignores it and
 * the page itself still syncs on open.
 *
 * The response does not wait for the derived half (transaction history, trade
 * values, Power Pulse). The caller is not reading the body; it wants the work
 * started. `after` keeps that half running past the response.
 *
 * Response shape:
 *   202 { ok: true, cached: boolean }   sync underway or already fresh
 *   400 { error: "Invalid league id" }
 *   403 { error: "Invalid request" }    (missing same-origin header)
 *   404 { error: "League not found" }
 *   429 { error: "Rate limited" }       (per-caller budget spent)
 *   500 { error: "Lookup failed" }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ league_id: string }> },
) {
  const { league_id: sleeperLeagueId } = await params;
  if (!sleeperLeagueId || !/^[a-zA-Z0-9_-]{1,64}$/.test(sleeperLeagueId)) {
    return NextResponse.json({ error: "Invalid league id" }, { status: 400 });
  }

  // Same-origin defense, matching the refresh endpoint: a custom header that
  // cross-origin form posts cannot set without a CORS preflight we never grant.
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const admin = createAdminClient();

  // What we already hold for this id decides whether this request can reach
  // Sleeper at all, and so which budget (if any) it has to claim.
  const { data: stored, error: lookupErr } = await admin
    .from("leagues")
    .select("last_pulsed_at, pulse_status")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (lookupErr) {
    console.error("[warm] league lookup failed", lookupErr);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  const budget = warmBudgetFor(stored ?? null, Date.now(), LEAGUE_PULSE_TTL_MS);
  if (budget && !(await claimRateLimitSlot(budget))) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const core = await pulseLeagueCore(admin, sleeperLeagueId);
  if (!core.ok) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  after(async () => {
    try {
      await pulseLeagueDerived(admin, core.leagueRowId, { resynced: !core.cached });
    } catch (err) {
      console.warn(`[warm] derived pass failed for ${sleeperLeagueId}:`, (err as Error).message);
    }
  });

  return NextResponse.json({ ok: true, cached: core.cached }, { status: 202 });
}
