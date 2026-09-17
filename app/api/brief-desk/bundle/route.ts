import { NextResponse } from "next/server";
import { getIsAdmin } from "@/lib/admin-auth";
import { logBeaconBrief } from "@/lib/beacon-brief/ai";
import { verifyBriefDeskRequest } from "@/lib/brief-desk/auth";
import { buildBundle } from "@/lib/brief-desk/bundle";
import { parseOverride } from "@/lib/brief-desk/override";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/brief-desk/bundle (plan section 9.2)
 *
 * The first of the desk's two doors. Bearer-authenticated with
 * BRIEF_DESK_TOKEN (lib/brief-desk/auth.ts, constant-time, fails closed),
 * rate limited at 10 per hour per actor through the shared ledger, and
 * answered by lib/brief-desk/bundle.ts, which decides whether an edition is
 * due. Nothing is written except a beacon_brief_logs row naming the route,
 * the period and the outcome; the token and the headers are never logged.
 *
 * Query on the normal path: none. The override (?season=2026&week=1, or
 * ?season=2026&period_end=2026-07-16) is accepted ONLY when the request also
 * carries an admin session; on the token alone it is answered 403.
 *
 * Responses:
 *   200  Bundle ({ due: true, ... }) or BundleNotDue ({ due: false, reason, next_close, next_period })
 *   400  { error }  malformed override query
 *   401  { error }  bad or missing token
 *   403  { error }  override query without an admin session
 *   429  { error }  rate limited
 *   500  { error }  BRIEF_DESK_TOKEN unset, or the builder threw
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  // A REFUSAL IS NEVER LOGGED TO THE DATABASE. The auth check runs first, which
  // is right, but the log row it used to write was a service-role INSERT with
  // nothing in front of it, so an unauthenticated loop against a guessable path
  // could fill beacon_brief_logs and bury the real desk lines. The console keeps
  // the refusal; beacon_brief_logs is for outcomes a caller earned, and section
  // 15 asks that stage to record the route, the period and the outcome, none of
  // which an unauthenticated request has.
  const auth = verifyBriefDeskRequest(req);
  if (!auth.ok) {
    console.warn(`brief-desk bundle GET: refused (${auth.status})`);
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Validate before claiming, the house rule stated for Trade Ideas: a
  // malformed override must not spend a legitimate caller's budget. A refusal
  // here is still a refusal BEFORE the rate limit, so it goes to the console
  // like the 401 does: a leaked token replaying an override would otherwise
  // insert a log row per request with nothing in front of it.
  const parsed = parseOverride(new URL(req.url).searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.override && !(await getIsAdmin())) {
    console.warn("brief-desk bundle GET: override refused, no admin session");
    return NextResponse.json({ error: "An override requires an admin session" }, { status: 403 });
  }

  if (!(await claimRateLimitSlot({ bucket: "brief-desk", max: 10, windowSeconds: 3600 }))) {
    await logBeaconBrief(admin, { stage: "brief_desk", level: "warn", message: "bundle GET: rate limited" });
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const bundle = await buildBundle(admin, new Date(), parsed.override);
    await logBeaconBrief(admin, {
      stage: "brief_desk",
      level: "info",
      message: bundle.due
        ? `bundle GET: due, ${describePeriod(bundle.edition)}${parsed.override ? " (override)" : ""}, ${bundle.relays.length} relays, ${Object.keys(bundle.players).length} players`
        : `bundle GET: not due (${bundle.reason})${parsed.override ? " (override)" : ""}`,
    });
    return NextResponse.json(bundle);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[brief-desk/bundle] failed", message);
    await logBeaconBrief(admin, { stage: "brief_desk", level: "error", message: `bundle GET: failed: ${message.slice(0, 400)}` });
    return NextResponse.json({ error: "Bundle build failed" }, { status: 500 });
  }
}

function describePeriod(e: { season: string; week: number | null; period_start: string; period_end: string }): string {
  return `${e.season} ${e.week === null ? "off-season" : `week ${e.week}`} ${e.period_start} to ${e.period_end}`;
}
